/* jshint node: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */
/* global describe, it */

"use strict";

var ALLOW_LIST = false;
var BACKUP_FILE = true;
var BLOCK_NEW = true;

var assert = require("assert");
var request = require("supertest");
request = request("http://localhost/RemoteStorage/");

var goodFiles = [
  {
    name: "first.txt",
    data: "hello\nthere"
  },
  {
    name: "second.png",
    data: "hello\r\nthere"
  },
  {
    name: "third",
    data: "\t\x00\\"
  },
  {
    name: "zero",
    data: ""
  }
];
var badFileNames = [
  { name: "../a" },
  { name: "..\\b" },
  { name: "c/d" },
  { name: "e\\f" },
  { name: "g/../../h" }
];

function forFiles(files, callback, done) {
  var pending = files.slice();
  pending.push(null);
  var next = function(err) {
    if (err) {
      throw err;
    }
    var file = pending.shift();
    if (file) {
      callback(file, next);
    } else {
      done();
    }
  };
  next();
}

function getCreateQueryParams(name, extra) {
  var params = { name: name };
  if (BLOCK_NEW) {
    var previousName = name + (extra || "");
    params.previousName = previousName;
  }
  return params;
}

function bypassBlockNew(name, next) {
  if (BLOCK_NEW) {
    var params = {
      name: name,
      bypass: true
    };
    request
      .put("")
      .query(params)
      .expect("Content-Type", /^text\/plain/)
      .expect(200, "", next);
  } else {
    next();
  }
}

function assertFileCount(visible, total) {
  return function(done) {
    request
      .get("")
      .expect(function(res) {
        assert.strictEqual(res.text.split("\r\n").length - 1, visible);
      })
      .end(function() {
        request
          .get("")
          .query({ backups: true })
          .expect(function(res) {
            assert.strictEqual(res.text.split("\r\n").length - 1, total);
          })
          .end(done);
      });
  };
}

describe("RemoteStorage", function() {

  if (ALLOW_LIST) {
    it("should return an empty list for no files", function(done) {
      request
        .get("")
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", done);
    });
  }

  it("should write each file", function(done) {
    var test = function() {
      forFiles(goodFiles, function(file, next) {
        request
          .put("")
          .query(getCreateQueryParams(file.name, ".previous"))
          .type("text")
          .send(file.data)
          .expect("Content-Type", /^text\/plain/)
          .expect(200, "", next);
      }, done);
    };
    if (BLOCK_NEW) {
      forFiles(goodFiles, function(file, next) {
        var params = {
          name: file.name + ".previous",
          bypass: true
        };
        request
          .put("")
          .query(params)
          .expect("Content-Type", /^text\/plain/)
          .expect(200, "", next);
      }, test);
    } else {
      test();
    }
  });

  if (ALLOW_LIST) {
    it("should list all files present", function(done) {
      request
        .get("")
        .expect("Content-Type", /^text\/plain/)
        .expect(200, goodFiles.map(function(file) {
          return file.name + "\r\n";
        }).join(""), done);
    });
  }

  it("should read each file", function(done) {
    forFiles(goodFiles, function(file, next) {
      request
        .get("")
        .query({ name: file.name })
        .expect("Content-Type", /^text\/plain/)
        .expect(200, file.data, next);
    }, done);
  });

  it("should fail to read a file that does not exist", function(done) {
    request
      .get("")
      .query({ name: "missing" })
      .expect(500, done);
  });

  it("should update each file", function(done) {
    forFiles(goodFiles, function(file, next) {
      request
        .put("")
        .query({ name: file.name })
        .type("text")
        .send("UPDATED\n" + file.data)
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", next);
    }, done);
  });

  it("should read each updated file", function(done) {
    forFiles(goodFiles, function(file, next) {
      request
        .get("")
        .query({ name: file.name })
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "UPDATED\n" + file.data, next);
    }, done);
  });

  if (ALLOW_LIST) {
    if (BACKUP_FILE) {
      it("should leave backups of changed files",
        assertFileCount(goodFiles.length, (BLOCK_NEW ? 3 : 2) * goodFiles.length));
    } else {
      it("should not leave backups of changed files",
        assertFileCount(goodFiles.length, goodFiles.length));
    }
  }

  it("should fail to delete a file that does not exist", function(done) {
    request
      .del("")
      .query({ name: "missing" })
      .expect(500, done);
  });

  it("should delete each file", function(done) {
    forFiles(goodFiles, function(file, next) {
      request
        .del("")
        .query({ name: file.name })
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", next);
    }, done);
  });

  if (ALLOW_LIST) {
    it("should return an empty list after deleting files", function(done) {
      request
        .get("")
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", done);
    });
  }

  if (ALLOW_LIST) {
    if (BACKUP_FILE) {
      it("should leave backups of deleted files",
        assertFileCount(0, (BLOCK_NEW ? 3 : 2) * goodFiles.length));
    } else {
      it("should not leave backups of deleted files",
        assertFileCount(0, 0));
    }
  }

  it("should fail to write a missing file name", function(done) {
    request
      .put("")
      .type("text")
      .send("")
      .expect(500, done);
  });

  it("should fail writes for bad file names", function(done) {
    forFiles(badFileNames, function(file, next) {
      request
        .put("")
        .query({ name: file.name })
        .type("text")
        .send(file.data)
        .expect(500, next);
    }, done);
  });

  if (BLOCK_NEW) {
    it("should fail to write a new file", function(done) {
      request
        .put("")
        .query({ name: "new-file" })
        .expect(500, done);
    });

    it("should fail to write a new file with a missing previous file", function(done) {
      request
        .put("")
        .query({ name: "new-file", previousName: "missing-file" })
        .expect(500, done);
    });
  }

  it("should backup/delete when creating with a different name", function(done) {
    var cleanup = function() {
      request
        .del("")
        .query({ name: "different-names" })
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", done);
    };
    var test = function() {
      request
        .put("")
        .query(getCreateQueryParams("different-names", ".previous"))
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", function() {
          assertFileCount(1, (BACKUP_FILE && BLOCK_NEW) ? 2 : 1)(cleanup);
        });
    };
    bypassBlockNew("different-names.previous", test);
  });

  it("should backup/delete when creating with the same name", function(done) {
    var cleanup = function() {
      request
        .del("")
        .query({ name: "same-names" })
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", done);
    };
    var test = function() {
      request
        .put("")
        .query(getCreateQueryParams("same-names", ""))
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", function() {
          assertFileCount(2, (BACKUP_FILE && BLOCK_NEW) ? 2 : 1)(cleanup);
        });
    };
    bypassBlockNew("same-names", test);
  });

  it("should be able to update a file and delete it", function(done) {
    var test = function() {
      request
        .put("")
        .query(getCreateQueryParams("update-file.txt"))
        .type("text")
        .send("Hello!")
        .expect("Content-Type", /^text\/plain/)
        .expect(200, "", function() {
          request
            .get("")
            .query({ name: "update-file.txt" })
            .expect("Content-Type", /^text\/plain/)
            .expect(200, "Hello!", function() {
              request
                .put("")
                .query({ name: "update-file.txt" })
                .type("text")
                .send("Bye.")
                .expect("Content-Type", /^text\/plain/)
                .expect(200, "", function() {
                  request
                    .get("")
                    .query({ name: "update-file.txt" })
                    .expect("Content-Type", /^text\/plain/)
                    .expect(200, "Bye.", function() {
                      request
                        .del("")
                        .query({ name: "update-file.txt" })
                        .expect("Content-Type", /^text\/plain/)
                        .expect(200, "", done);
                    });
                });
            });
        });
    };
    bypassBlockNew("update-file.txt", test);
  });

  it("should be able to list/create/read/update/delete via POST", function(done) {
    var test = function() {
      var body = function() {
        request
          .post("")
          .type("form")
          .send({ method: "put", name: "post-file.txt", content: "Hello!" })
          .expect("Content-Type", /^text\/plain/)
          .expect(200, "", function() {
            request
              .post("")
              .type("form")
              .send({ method: "get", name: "post-file.txt" })
              .expect("Content-Type", /^text\/plain/)
              .expect(200, "Hello!", function() {
                request
                  .post("")
                  .type("form")
                  .send({ method: "put", name: "post-file.txt", content: "Bye." })
                  .expect("Content-Type", /^text\/plain/)
                  .expect(200, "", function() {
                    request
                      .post("")
                      .type("form")
                      .send({ method: "get", name: "post-file.txt" })
                      .expect("Content-Type", /^text\/plain/)
                      .expect(200, "Bye.", function() {
                        request
                          .post("")
                          .type("form")
                          .send({ method: "delete", name: "post-file.txt" })
                          .expect("Content-Type", /^text\/plain/)
                          .expect(200, "", done);
                      });
                  });
              });
          });
      };
      if (ALLOW_LIST) {
        request
          .post("")
          .type("form")
          .send({ method: "get" })
          .expect("Content-Type", /^text\/plain/)
          .expect(200, "", body);
      } else {
        body();
      }
    };
    bypassBlockNew("post-file.txt", test);
  });

  it("should fail when the method parameter is missing via POST", function(done) {
    request
      .post("")
      .expect(500, done);
  });
});
