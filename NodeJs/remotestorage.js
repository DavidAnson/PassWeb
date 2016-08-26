/* jshint node: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */

"use strict";

// Initialize variables
var process = require("process");
var stream = require("stream");
var util = require("util");
var throttleExpiration = Date.now();
var options = {
  // Set to use Azure blob storage instead of local files
  // Uses standard environment variables AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_ACCESS_KEY
  BLOB_STORAGE_AZURE: false,
  // Set to allow callers to list files (not required for PassWeb)
  ALLOW_LIST: false,
  // Set to enable the creation of backup files for each change
  BACKUP_FILE: true,
  // Set to block the creation of new files (set environment variable to "false" to override)
  BLOCK_NEW: process.env.BLOCK_NEW !== "false",
  // Set to allow requests to be handled as fast as possible
  THROTTLE_REQUESTS: true,
  // Set to allow bypass of BLOCK_NEW (necessary when testing)
  TEST_ALLOW_BYPASS_BLOCK_NEW: false,
  // Set to allow list to include backup files (necessary when testing)
  TEST_ALLOW_LIST_INCLUDE_BACKUPS: false,
  // Set to use a unique storage directory (preferred when testing)
  TEST_CREATE_UNIQUE_DIRECTORY: false,
  // Used to log diagnostic messages
  log: util.debuglog("remotestorage")
};

function remotestorage(router, directory) {
  // Create a specific storage implementation
  var storageModule = options.BLOB_STORAGE_AZURE ? "./storage-blob-azure" : "./storage-file";
  var implementation = require(storageModule)(options, directory);

  // Add route to map POST/method=? calls into the corresponding GET/PUT/DELETE
  router.route("/RemoteStorage")
    .post(function(req, res, next) {
      // Get parameters
      req.method = (req.body.method || "[MISSING METHOD]").toLowerCase();
      req.query.name = req.body.name;
      req.query.previousName = req.body.previousName;
      // Capture content into a readable stream (to mimic content of GET/PUT/DELETE)
      var readable = new stream.Readable();
      readable.push(req.body.content);
      readable.push(null);
      req.content = readable;
      // Hand off to next route
      next();
    });

  // Add routes for GET/PUT/DELETE
  router.route("/RemoteStorage")
    .all(function(req, res, next) {
      // Log request and set response type, then hand off to next route
      options.log(req.method + " " + req.url);
      res.type("text");
      // Throttle requests to slow enumeration of storage files
      if (options.THROTTLE_REQUESTS) {
        var now = Date.now();
        var waitDuration = Math.max(throttleExpiration - now, 0);
        throttleExpiration = now + 1000 + waitDuration;
        setTimeout(function() {
          next();
        }, waitDuration);
      } else {
        next();
      }
    })
    .put(implementation.writeFile)
    .get(function(req, res) {
      if (req.query.name) {
        implementation.readFile(req, res);
      } else if (options.ALLOW_LIST) {
        implementation.listFiles(req, res);
      } else {
        res.sendStatus(500);
      }
    })
    .delete(implementation.deleteFile);

  return router;
}

module.exports = remotestorage;
