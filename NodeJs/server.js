/* jshint node: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */

"use strict";

// Default port to listen on
var port = process.env.PORT || 80;
// Set to host static content (HTML/CSS/JS) for the client component
var STATIC_SERVER = false;

// Initialize Express
var path = require("path");
var express = require("express");
var bodyParser = require("body-parser");
var remotestorage = require("./remotestorage");
var app = express();

// Configure Express
app.set("x-powered-by", false);
if (STATIC_SERVER) {
  // Configure a custom router to block non-public content
  var rejectRouter = express.Router();
  rejectRouter.use(function(req, res) {
    res.sendStatus(500);
  });
  app.use("/App_Code", rejectRouter);
  app.use("/App_Data", rejectRouter);
  app.use("/NodeJs", rejectRouter);
  app.use("/Test", rejectRouter);
  // Serve static content
  app.use(express.static(path.join(__dirname, "/.."), { index: "default.htm" }));
}

// Configure remotestorage middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(remotestorage(express.Router()));

// Fail all other requests
app.use(function(req, res) {
  res.sendStatus(500);
});

// Start Express server (HTTP)
app.listen(port);
console.log(__filename + " listening on port " + port + "...");
// Listen on HTTPS as well
/* require("https").createServer({
  key: fs.readFileSync(...),
  cert: fs.readFileSync(...)
}, app).listen(443); */
