/* jshint node: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */
/* global Promise */

"use strict";

// Initialize dependencies
var azureStorage = require("azure-storage");
var pify = require("pify");

function create(options, container) {
  var log = options.log;
  if (options.TEST_CREATE_UNIQUE_DIRECTORY) {
    container = Date.now().toString();
  }

  // Initialize variables
  var service = azureStorage.createBlobService();
  var createBlobSnapshotPromise = pify(service.createBlobSnapshot.bind(service));
  var createBlockBlobFromTextPromise = pify(service.createBlockBlobFromText.bind(service));
  var createContainerIfNotExistsPromise = pify(service.createContainerIfNotExists.bind(service));
  var deleteBlobPromise = pify(service.deleteBlob.bind(service));
  var doesBlobExistPromise = pify(service.doesBlobExist.bind(service));
  var getBlobMetadataPromise = pify(service.getBlobMetadata.bind(service));
  var listBlobsSegmentedPromise = pify(service.listBlobsSegmented.bind(service));

  // Backup (if necessary) and delete
  function backupAndDelete(blob) {
    if (options.BACKUP_FILE) {
      return createBlobSnapshotPromise(container, blob)
        .then(function() {
          return createBlockBlobFromTextPromise(container, blob, "", { metadata: { deleted: true } });
        });
    } else {
      return deleteBlobPromise(container, blob);
    }
  }

  // Write file
  function writeFile(req, res) {
    var blob = req.query.name;
    var previousBlob = req.query.previousName;
    log("Writing: " + blob);
    Promise.resolve()
      .then(function() {
        var badName = /[\/\\]/;
        if (!blob || badName.test(blob) || (previousBlob && badName.test(previousBlob))) {
          throw new Error("Invalid arguments to writeFile.");
        }
      })
      .then(function() {
        return createContainerIfNotExistsPromise(container);
      })
      .then(function() {
        return doesBlobExistPromise(container, blob);
      })
      .then(function(blobResult) {
        // Check permissions and backup
        if (blobResult.exists) {
          if (options.BACKUP_FILE) {
            return createBlobSnapshotPromise(container, blob);
          }
          // Else overwrite existing file
        } else if (!options.BLOCK_NEW || (options.TEST_ALLOW_BYPASS_BLOCK_NEW && req.query.bypass)) {
          return; // Write new file
        } else {
          return doesBlobExistPromise(container, previousBlob)
            .then(function(previousResult) {
              if (previousResult.exists) {
                return backupAndDelete(previousBlob);
              } else {
                throw new Error("Not allowed to create new file.");
              }
            });
        }
      })
      .then(function() {
        return new Promise(function(resolve, reject) {
          var reqStream = req.content || req;
          var blobStream = service.createWriteStreamToBlockBlob(container, blob);
          [reqStream, blobStream].forEach(function (stream) {
            stream
              .on("end", resolve)
              .on("error", reject);
          });
          reqStream.pipe(blobStream);
        });
      })
      .then(function() {
        res.status(200).send("");
      })
      .catch(function() {
        res.sendStatus(500);
      });
  }

  // Lists files
  function listFiles(req, res) {
    log("Listing: " + container);
    // Initialize
    var include = "metadata";
    if (options.TEST_ALLOW_LIST_INCLUDE_BACKUPS && req.query.backups) {
      include += ",snapshots";
    }
    var listOptions = {
      // maxResults: 3, // Uncomment to test continuation token handling
      include: include
    };
    var names = [];
    var listNextBlobs = function(continuationToken) {
      return listBlobsSegmentedPromise(container, continuationToken, listOptions)
        .then(function(result) {
          result.entries
            .filter(function(blobResult) {
              return !blobResult.metadata.deleted;
            })
            .forEach(function(blobResult) {
              names.push(blobResult.name);
            });
          if (result.continuationToken) {
            return listNextBlobs(result.continuationToken);
          }
          // Else proceed
        });
    };
    Promise.resolve()
      .then(function() {
        return createContainerIfNotExistsPromise(container);
      })
      .then(function() {
        return listNextBlobs(null);
      })
      .then(function() {
        if (names.length) {
          names.push("");
        }
        res.status(200).send(names.join("\r\n"));
      })
      .catch(function() {
        res.sendStatus(500);
      });
  }

  // Read file
  function readFile(req, res) {
    var blob = req.query.name;
    log("Reading: " + blob);
    Promise.resolve()
      .then(function() {
        if (!blob) {
          throw new Error("Invalid arguments to readFile.");
        }
      })
      .then(function() {
        return getBlobMetadataPromise(container, blob);
      })
      .then(function(result) {
        if (result.metadata.deleted) {
          throw new Error("Blocking read of deleted file.");
        }
        service.createReadStream(container, blob, function(error) {
          if (error && !res.finished) {
            res.sendStatus(500);
          }
        })
        .on("error", function() {
          res.sendStatus(500);
        })
        .pipe(res);
      })
      .catch(function() {
        res.sendStatus(500);
      });
  }

  // Delete file
  function deleteFile(req, res) {
    var blob = req.query.name;
    log("Deleting: " + blob);
    Promise.resolve()
      .then(function() {
        if (!blob) {
          throw new Error("Invalid arguments to deleteFile.");
        }
      })
      .then(function() {
        return backupAndDelete(blob);
      })
      .then(function() {
        res.status(200).send("");
      })
      .catch(function() {
        res.sendStatus(500);
      });
  }

  // Return implementation
  return {
    deleteFile: deleteFile,
    listFiles: listFiles,
    readFile: readFile,
    writeFile: writeFile
  };
}

module.exports = create;
