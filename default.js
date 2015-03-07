/// <reference path="aes.js"/>
/// <reference path="sha512.js"/>
/// <reference path="jquery-2.1.3.js"/>
/// <reference path="knockout-3.3.0.debug.js"/>
/// <reference path="lz-string-1.3.3.js"/>

/* jshint browser: true, jquery: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */
/* global ko, CryptoJS, LZString */

(function (undefined) {
    "use strict";

    // Master user name/pass phrase
    var UserNameUpper;
    var PassPhrase;
    var CacheLocally;

    // String added to hash/encryption key to make each PassWeb instance unique
    var UniqueText = window.location.hostname.toLocaleUpperCase();

    // Hashes the user name+password+unique text to determine the data file name
    function getCredentialHash() {
        return CryptoJS.SHA512(UserNameUpper + PassPhrase + UniqueText).toString();
    }

    // Gets the encryption key
    function getEncryptionKey() {
        return PassPhrase + UniqueText;
    }

    // Implementation of the login form
    function LoginForm() {
        var self = this;
        var usernameKey = "username";
        var cacheKey = "cache";
        self.username = ko.observable(localStorageGetItem(usernameKey));
        self.password = ko.observable();
        self.cache = ko.observable(true.toString() === localStorageGetItem(cacheKey));

        // Handles submit for login
        self.submit = function () {
            resetInactivityTimeout();
            var usernameValue = self.username() || "";
            localStorageSetItem(usernameKey, usernameValue);
            UserNameUpper = usernameValue.toLocaleUpperCase();
            PassPhrase = self.password() || "";
            CacheLocally = !!self.cache();
            localStorageSetItem(cacheKey, CacheLocally.toString());
            if (!CacheLocally) {
                // Delete any previously saved data
                removeFromLocalStorage();
            }
            $("#loginPage").hide();
            enableMainPage(true);
            readFromLocalStorage();
            readFromRemoteStorage();
            return false;
        };
    }
    var loginForm = new LoginForm();

    // Implementation of the status bars
    function Status() {
        var self = this;
        var id = 1;
        self.progress = ko.observable();
        self.errors = ko.observableArray();

        // Shows (or clears) the progress message
        self.showProgress = function (message) {
            self.progress(message);
        };

        // Adds an error message to the list
        self.showError = function (message) {
            self.errors.unshift({
                id: id++,
                message: message
            });
        };

        // Removes an error message from the list
        self.removeError = function (error) {
            self.errors.remove(error);
        };
    }
    var status = new Status();

    // Implementation of the user data store
    function UserData() {
        var self = this;
        self.schema = 1;
        self.timestamp = 0;
        self.entries = ko.observableArray();
        self.filter = ko.observable("");

        // Filters the entries according to the search text
        self.filteredEntries = ko.computed(function () {
            var filterUpper = self.filter().toLocaleUpperCase();
            if (0 < filterUpper.length) {
                return self.entries().filter(function (e) {
                    return ((-1 !== e.id.toLocaleUpperCase().indexOf(filterUpper)) ||
                            (-1 !== (e.username || "").toLocaleUpperCase().indexOf(filterUpper)));
                });
            }
            return self.entries();
        });

        // Copies/unhides+selects the user name
        self.copyusername = function (entry, event) {
            resetInactivityTimeout();
            self.copytext(entry.username, event.target);
        };

        // Copies/unhides+selects the password
        self.copypassword = function (entry, event) {
            resetInactivityTimeout();
            self.copytext(entry.password, event.target);
        };

        // Toggles the display of the notes field for an entry
        self.togglenotes = function (entry, event) {
            resetInactivityTimeout();
            var content = $(event.target).closest(".notes").find(".content").first();
            if (content.is(":visible")) {
                content.hide();
            } else {
                content.show();
            }
        };

        // Populates the entry field with an entry's data
        self.edit = function (entry) {
            resetInactivityTimeout();
            entryForm.populateFrom(entry);
        };

        // Removes an entry (with confirmation)
        self.remove = function (entry) {
            resetInactivityTimeout();
            if (window.confirm("Delete \"" + entry.id + "\"?")) {
                userData.entries.remove(entry);
                updateTimestampAndSaveToAllStorage();
            }
        };

        // Copies text to the clipboard or unmasks an element and selects its text
        self.copytext = function (text, element) {
            if (!window.clipboardData || !window.clipboardData.setData("Text", text)) { // clipboardData API only supported by Internet Explorer
                var $element = $(element);
                $element.text(text);
                if (self.contentEditableNeeded()) {
                    // Required on iOS Safari to show the selection
                    $element.attr("contentEditable", true);
                }
                var selection = window.getSelection();
                selection.removeAllRanges();
                var range = document.createRange();
                range.setStart(element, 0); // Note: selectNode API is not as reliable (especially on iOS Safari)
                range.setEnd(element, 1);
                selection.addRange(range);
                // Set a timer to re-mask the text
                setTimeout(function () {
                    $element.removeAttr("contentEditable");
                    $element.text($element.attr("data-mask") || text);
                }, 10 * 1000); // 10 seconds
            }
        };

        // Returns a value indicating whether the contentEditable attribute is needed
        self.contentEditableNeeded = (function () {
            var needed = !!navigator.userAgent.match(/iP(hone|ad|od touch)/i);
            return function () {
                return needed;
            };
        })(); // Memoized
    }
    var userData = new UserData();

    // Implementation of the entry form
    function EntryForm() {
        var self = this;
        self.expanded = ko.observable(false);
        self.id = ko.observable();
        self.username = ko.observable();
        self.password = ko.observable();
        self.website = ko.observable();
        self.notes = ko.observable();
        self.linkAccessKey = ko.observable("n");
        self.inputAccessKey = ko.observable(null);

        // Clears the entry form
        self.clear = function () {
            resetInactivityTimeout();
            self.id("");
            self.username("");
            self.password("");
            self.website("");
            self.notes("");
        };
        self.clear();

        // Returns true if valid (i.e., ID and password present)
        self.isValid = function () {
            return $.trim(self.id()) && self.password();
        };

        // Populates the form by copying fields from an entry
        self.populateFrom = function (entry) {
            self.id(entry.id);
            self.username(entry.username);
            self.password(entry.password);
            self.website(entry.website);
            self.notes(entry.notes);
            self.expand();
        };

        // Creates a new entry after validating the input
        self.submit = function () {
            resetInactivityTimeout();
            if (self.isValid()) {
                var entry = {
                    timestamp: Date.now(),
                    id: $.trim(self.id()),
                    username: self.username(),
                    password: self.password(),
                    website: self.website(),
                    notes: $.trim(self.notes()),
                    weak: ko.observable(isWeakPassword(self.password()))
                };
                var existing = userData.entries().filter(function (e) {
                    return 0 === entryComparer(e, entry);
                });
                if ((0 === existing.length) || window.confirm("Update existing entry?")) {
                    userData.entries.removeAll(existing);
                    userData.entries.push(entry);
                    userData.entries.sort(entryComparer);
                    updateTimestampAndSaveToAllStorage();
                    self.clear();
                    userData.filter("");
                    self.expand(); // Reset focus to first input
                }
            } else {
                // Validation for browsers that don't support HTML validation
                window.alert("Incomplete or invalid entry.");
            }
            return false;
        };

        // Simulates a click of submit button so browser will run HTML form validation
        self.clickSubmit = function (entry, event) {
            $(event.target).closest("form").find("input[type='submit']").trigger("click");
        };

        // Expands the entry form
        self.expand = function () {
            resetInactivityTimeout();
            self.linkAccessKey(null);
            self.inputAccessKey("n");
            self.expanded(true);
            var entryFormElement = $("#entryForm");
            entryFormElement[0].scrollIntoView();
            entryFormElement.find("input")[0].focus();
        };

        // Generates a random/secure password
        self.generatePassword = function () {
            resetInactivityTimeout();
            var pool = "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
            var password = "";
            var i;
            for (i = 0; i < 16; i++) {
                password += (pool[self.getRandomInt(0, pool.length - 1)]);
            }
            var message = "Random password for this entry:";
            var promptResult = window.prompt(message, password);
            if (promptResult || ("" === promptResult)) {
                self.password(promptResult);
            } else if (undefined === promptResult) {
                // Windows 8 immersive/metro Internet Explorer does not support window.prompt (http://dlaa.me/blog/post/windowprompt)
                self.password(password);
                window.alert(message + " " + password);
            }
        };

        // Gets a random integer between min and max (inclusive)
        self.getRandomInt = function (min, max) {
            return Math.floor((Math.random() * (max - min + 1)) + min);
        };
    }
    var entryForm = new EntryForm();

    // Enables the main page UI
    function enableMainPage(enable) {
        var mainPage = $("#mainPage");
        if (enable) {
            mainPage.show();
        } else {
            mainPage.hide();
        }
    }

    // Merges imported data with what has already been loaded
    function mergeImportedData(encodedData, fromLocalStorage) {
        var data;
        try {
            data = decode(encodedData);
            enableMainPage(true);
        } catch (ex) {
            enableMainPage(false);
            return "Decryption failure for " + (fromLocalStorage ? "local" : "cloud") + " data. Wrong password?";
        }
        if (data && (1 === data.schema)) {
            if (userData.timestamp !== data.timestamp) {
                // Different data
                var validDataEntries = data.entries.filter(function (e) {
                    return e.hasOwnProperty("timestamp") &&
                           e.hasOwnProperty("id") &&
                           e.hasOwnProperty("username") &&
                           e.hasOwnProperty("password") &&
                           e.hasOwnProperty("website") &&
                           e.hasOwnProperty("notes");
                }).sort(entryComparer);
                data.entries.forEach(function (e) {
                    e.weak = ko.observable(isWeakPassword(e.password));
                });
                if (0 === userData.timestamp) {
                    // No data has been loaded yet; use imported data as-is
                    userData.timestamp = data.timestamp;
                    userData.entries(validDataEntries);
                    if (!fromLocalStorage) {
                        saveToLocalStorage();
                    }
                } else {
                    // Merge loaded data with new data
                    var changed = false;
                    var userDataEntries = userData.entries().slice(); // Clone so pop() doesn't affect the original
                    var mergedEntries = [];
                    var sentinel = { id: "", timestamp: 0 };
                    // Walk both lists in parallel
                    var compareResult;
                    var uniqueEntry;
                    var otherListTimestamp;
                    var userDataEntry = userDataEntries.pop() || sentinel;
                    var validDataEntry = validDataEntries.pop() || sentinel;
                    while ((userDataEntry !== sentinel) || (validDataEntry !== sentinel)) {
                        compareResult = entryComparer(userDataEntry, validDataEntry);
                        if (0 === compareResult) {
                            // Same entry; pick the most recent
                            if (userDataEntry.timestamp === validDataEntry.timestamp) {
                                mergedEntries.push(userDataEntry);
                            } else if (userDataEntry.timestamp < validDataEntry.timestamp) {
                                mergedEntries.push(validDataEntry);
                                changed = true;
                            } else {
                                mergedEntries.push(userDataEntry);
                                changed = true;
                            }
                            // Advance both lists
                            userDataEntry = userDataEntries.pop() || sentinel;
                            validDataEntry = validDataEntries.pop() || sentinel;
                        } else {
                            // Different entries, work with the "biggest"
                            if (compareResult < 0) {
                                uniqueEntry = validDataEntry;
                                validDataEntry = validDataEntries.pop() || sentinel;
                                otherListTimestamp = userData.timestamp;
                            } else {
                                uniqueEntry = userDataEntry;
                                userDataEntry = userDataEntries.pop() || sentinel;
                                otherListTimestamp = data.timestamp;
                            }
                            if (otherListTimestamp < uniqueEntry.timestamp) {
                                // Include entry created after other list was modified (addition)
                                mergedEntries.push(uniqueEntry);
                            } /* else {
                                // Exclude entry absent from other list (deletion)
                            } */
                            changed = true;
                        }
                    }
                    if (changed) {
                        // Update local/remote storage with merged results
                        mergedEntries.reverse();
                        userData.entries(mergedEntries);
                        updateTimestampAndSaveToAllStorage();
                        if (!fromLocalStorage) {
                            return "Cloud data had changes; local and cloud are now synchronized.";
                        }
                    } else {
                        // No changes; update local timestamp to match
                        userData.timestamp = data.timestamp;
                        saveToLocalStorage();
                    }
                }
            }
        } else {
            return "Unsupported schema or corrupt data.";
        }
        return null;
    }

    // Update data timestamp and save to local/remote
    function updateTimestampAndSaveToAllStorage(previousName) {
        userData.timestamp = Date.now();
        saveToLocalStorage();
        return saveToRemoteStorage(previousName);
    }

    // Reads data from local storage
    function readFromLocalStorage() {
        var item = localStorageGetItem(getCredentialHash());
        if (item) {
            var result = mergeImportedData(item, true);
            if (result) {
                status.showError(result);
            }
        }
    }

    // Saves data to local storage
    function saveToLocalStorage() {
        if (CacheLocally) {
            var item = encode(userData);
            localStorageSetItem(getCredentialHash(), item);
        }
    }

    // Removes data from local storage
    function removeFromLocalStorage() {
        localStorageRemoveItem(getCredentialHash());
    }

    // Gets the remote storage URI, converting to HTTPS if not already using it (unless using localhost)
    function getRemoteStorageUri() {
        var location = window.location;
        var protocol = ("localhost" === location.hostname) ? location.protocol : "https:";
        var pathname = location.pathname.replace(/\/[^\/]+$/, "/") + "RemoteStorage";
        var remoteStorageUri = protocol + "//" + location.host + pathname;
        return remoteStorageUri;
    }

    // Reads data from remote storage
    function readFromRemoteStorage() {
        status.showProgress("Reading from cloud...");
        $.ajax(getRemoteStorageUri(), {
            type: "GET",
            data: {
                name: getCredentialHash()
            },
            dataType: "text",
            cache: false
        }).done(function (data) {
            var result = mergeImportedData(data, false);
            if (result) {
                status.showError(result);
            }
        }).fail(function (result) {
            var implication = userData.entries().length ? "using local data" : "no local data available";
            var reason = navigatorOnLine() ? "Network problem or bad user name/password?" : "Network appears offline.";
            var message = "Error reading from cloud; " + implication + ". (" + reason + ")";
            status.showError(message);
            logNetworkFailure(message, result);
        }).always(function () {
            status.showProgress(null);
        });
    }

    // Saves data to remote storage
    function saveToRemoteStorage(previousName) {
        status.showProgress("Saving to cloud...");
        return $.ajax(getRemoteStorageUri(), {
            type: "POST",
            data: {
                method: "PUT",
                name: getCredentialHash(),
                previousName: previousName,
                content: encode(userData)
            }
        }).fail(function (result) {
            var implication = CacheLocally ? "Data was saved locally; cloud will be updated when possible." : "Not caching, so data may be lost when browser is closed!";
            var reason = navigatorOnLine() ? "" : " (Network appears offline.)";
            var message = "Error saving to cloud. " + implication + reason;
            status.showError(message);
            logNetworkFailure(message, result);
        }).always(function () {
            status.showProgress(null);
        });
    }

    // Removes data from remote storage
    function removeFromRemoteStorage(credentialHash) {
        $.ajax(getRemoteStorageUri(), {
            type: "POST",
            data: {
                method: "DELETE",
                name: credentialHash
            }
        }).fail(function (result) {
            logNetworkFailure("[Error deleting from cloud.]", result);
        });
    }

    // Encrypts and compresses all entries
    function encode(data) {
        var json = ko.toJSON(data, ["schema", "timestamp", "entries", "id", "username", "password", "website", "notes"]);
        var base64 = LZString.compressToBase64(json);
        var cipherParams = CryptoJS.AES.encrypt(base64, getEncryptionKey());
        return cipherParams.toString();
    }

    // Decrypts and decompresses all entries
    function decode(data) {
        var cipherParams = CryptoJS.AES.decrypt(data, getEncryptionKey());
        var base64 = cipherParams.toString(CryptoJS.enc.Utf8);
        var json = base64 ? LZString.decompressFromBase64(base64) : "";
        return $.parseJSON(json);
    }

    // Compares entry IDs locale-aware
    function entryComparer(a, b) {
        var aidl = a.id.toLocaleUpperCase();
        var bidl = b.id.toLocaleUpperCase();
        if (aidl === bidl) {
            return 0;
        }
        if (aidl < bidl) {
            return -1;
        }
        return 1;
    }

    function isWeakPassword(password) {
        var problem = null;
        if (password.length < 8) {
            problem = "Too short";
        } else if (/^[A-Za-z]+$/.test(password)) {
            problem = "Only letters";
        } else if (/^[0-9]+$/.test(password)) {
            problem = "Only numbers";
        } else if (/^[A-Za-z0-9]+$/.test(password)) {
            problem = "No symbols";
        }
        if (problem) {
            return "[Weak: " + problem + "]";
        } else {
            return false;
        }
    }

    // Inactivity timeout reloads the page if the user hasn't interacted with it for a while
    var inactivityTimeout;
    function clearInactivityTimeout() {
        if (inactivityTimeout) {
            window.clearTimeout(inactivityTimeout);
            inactivityTimeout = null;
        }
    }
    function resetInactivityTimeout() {
        clearInactivityTimeout();
        inactivityTimeout = window.setTimeout(function () {
            window.document.location.reload();
        }, 3 * 60 * 1000); // 3 minutes
    }

    // Safe wrappers for localStorage
    function localStorageGetItem(key) {
        return localStorage.getItem(key);
    }
    function localStorageSetItem(key, data) {
        try {
            localStorage.setItem(key, data);
        } catch (ignore) {
            // Ignore failure (ex: private mode)
        }
    }
    function localStorageRemoveItem(key) {
        localStorage.removeItem(key);
    }

    // Safe wrapper for navigator
    function navigatorOnLine() {
      return !window.navigator || navigator.onLine;
    }

    // Logs a network failure message to the console
    function logNetworkFailure(message /*, result*/) {
        consoleLog(message);
        //consoleLog(result.status + ": " + result.statusText + "\n" + result.responseText);
        consoleLog("File name: " + getCredentialHash());
    }

    // Logs a message to the console
    function consoleLog(message) {
        if (window.console && window.console.log) {
            window.console.log(message);
        }
    }

    // Outputs all entries to the console
    //function debugLogEntries() {
    //    userData.entries().forEach(function (entry) {
    //        consoleLog(entry.id + ", " + entry.timestamp + ", " + entry.username + ", " + entry.password + ", " + entry.website + ", " + (entry.notes || "").split("\n"));
    //    });
    //}

    // FAQ items
    var faqs = [
        {
            question: "What is PassWeb?",
            answer: "PassWeb is a simple online/offline web application to securely manage passwords. " +
                "Data is encrypted locally and stored in the cloud so it's available from anywhere. " +
                "Unencrypted data never leaves the machine, so YOU are in total control."
        },
        {
            question: "How do I use PassWeb?",
            answer: "Click an entry's title to open its web site. " +
                "Click the name/password field to copy (where supported) or select it for you to copy+paste. " +
                "Click the padlock to generate a random, complex password for each site. " +
                "Notes store additional info."
        },
        {
            question: "How do I create a login?",
            answer: "Contact me with the user name you want and I'll create a new account with a temporary password. " +
                "Log in, change the master password to something only you know (and won't ever forget!), then create entries for all your accounts."
        },
        {
            question: "What if I'm not online?",
            answer: "Checking the \"Cache encrypted passwords\" box makes your data available offline. " +
                "Changes are synchronized with the server next time you use PassWeb online. " +
                "Simple updates merge seamlessly; overlapping updates should be avoided."
        },
        {
            question: "What if I leave PassWeb open?",
            answer: "It's okay: PassWeb logs you out after three minutes of inactivity to protect your data. " +
                "Names and passwords unmasked for copy+paste are re-masked after ten seconds to prevent anyone nearby from reading them."
        },
        {
            question: "Why shouldn't I use untrusted devices?",
            answer: "Untrusted machines (like a library kiosk or a friend's laptop) may have malware installed that records keystrokes. " +
                "Typing your master password on such a device would compromise it, allowing an attacker use your PassWeb account."
        },
        {
            question: "What if I forget the master password?",
            answer: "Sorry, your data is irretrievably lost! " +
                "PassWeb's encryption algorithm is government-grade and there aren't any backdoors or secondary passwords. " +
                "It's up to you to remember the master password - and keep it secure!"
        },
        {
            question: "What browsers can I use?",
            answer: "Because it's simple and standards-based, PassWeb works cross-platform on modern browsers like recent releases of Internet Explorer, Chrome, Firefox, and Safari. " +
                "If you see a problem, please email me detailed steps to reproduce it."
        },
        {
            question: "How was PassWeb developed?",
            answer: "The client is built with HTML, CSS, and JavaScript and uses the jQuery, Knockout, crypto-js, and lz-string libraries. " +
                "The server's REST API runs on ASP.NET or Node.js. " +
                "Encryption is 256-bit AES in CBC mode. " +
                "Hashing is SHA-512."
        },
    ];

    $(function () {
        // Initialize
        ko.applyBindings(loginForm, $("#loginForm")[0]);
        ko.applyBindings(faqs, $("#faqs")[0]);
        ko.applyBindings(status, $("#status")[0]);
        ko.applyBindings(userData, $("#entriesList")[0]);
        ko.applyBindings(userData, $("#filter")[0]);
        ko.applyBindings(entryForm, $("#entryForm")[0]);
        $("#mainPage input").add("#mainPage textarea").on("input", resetInactivityTimeout);
        $(window).on("scroll", resetInactivityTimeout);
        $("#mainPage .small a").on("click", function (event) {
            // Prompt to change master password
            var newPassPhrase = window.prompt("New master password:", "");
            if (newPassPhrase || ("" === newPassPhrase)) {
                var previousPassPhrase = PassPhrase;
                var previousCredentialHash = getCredentialHash();
                removeFromLocalStorage();
                PassPhrase = newPassPhrase;
                updateTimestampAndSaveToAllStorage(previousCredentialHash).then(function () {
                    // Success, clean up remote storage
                    removeFromRemoteStorage(previousCredentialHash);
                }).fail(function () {
                    // Failure, restore old password locally (already unchanged remotely)
                    removeFromLocalStorage();
                    PassPhrase = previousPassPhrase;
                    saveToLocalStorage();
                    status.showError("Master password update failed; password unchanged!");
                });
            }
            event.preventDefault();
        });
        // setTimeout call works around an Internet Explorer bug where textarea/placeholder's input event fires asynchronously on load (http://dlaa.me/blog/post/inputplaceholder)
        window.setTimeout(function () {
            clearInactivityTimeout();
        }, 10);
    });
})();
