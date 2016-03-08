/* jshint browser: true, bitwise: true, curly: true, eqeqeq: true, forin: true, freeze: true, immed: true, indent: 4, latedef: true, newcap: true, noarg: true, noempty: true, nonbsp: true, nonew: true, quotmark: double, undef: true, unused: true, strict: true, trailing: true */
/* global ajax, observable, render, CryptoJS, LZString */

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
        self.username = observable(localStorageGetItem(usernameKey) || "");
        self.password = observable("");
        self.cache = observable(true.toString() === localStorageGetItem(cacheKey));

        // Handles submit for login
        self.submit = function () {
            resetInactivityTimeout();
            var usernameValue = self.username();
            localStorageSetItem(usernameKey, usernameValue);
            UserNameUpper = usernameValue.toLocaleUpperCase();
            PassPhrase = self.password();
            CacheLocally = self.cache();
            localStorageSetItem(cacheKey, CacheLocally.toString());
            if (!CacheLocally) {
                // Delete any previously saved data
                removeFromLocalStorage();
            }
            enableMainPage(true);
            readFromLocalStorage();
            readFromRemoteStorage();
        };
    }
    var loginForm = new LoginForm();

    // Implementation of the status bars
    function Status() {
        var self = this;
        var id = 1;
        self.progress = observable();
        self.errors = observable([]);

        // Shows (or clears) the progress message
        self.showProgress = function (message) {
            self.progress(message);
        };

        // Adds an error message to the list
        self.showError = function (message) {
            var errors = self.errors();
            errors.unshift({
                id: id++,
                message: message
            });
            self.errors(errors, true);
        };

        // Removes an error message from the list
        self.removeError = function (error) {
            var errors = self.errors();
            errors.splice(errors.indexOf(error), 1);
            self.errors(errors, true);
        };
    }
    var status = new Status();

    // Implementation of the user data store
    function UserData() {
        var self = this;
        self.schema = 1;
        self.timestamp = 0;
        self.entries = observable([]);
        self.filter = observable("");
        self.visibleEntries = observable(self.entries());

        // Filters the entries according to the search text
        function filterEntries() {
            var filterUpper = self.filter().toLocaleUpperCase();
            self.visibleEntries(self.entries().map(function (entry) {
                var visible = ((0 === filterUpper.length) ||
                               (-1 !== entry.id.toLocaleUpperCase().indexOf(filterUpper)) ||
                               (-1 !== (entry.username || "").toLocaleUpperCase().indexOf(filterUpper)));
                return {
                    entry: entry,
                    visible: visible
                };
            }));
        }
        self.entries.subscribe(filterEntries);
        self.filter.subscribe(filterEntries);

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
        self.togglenotes = function () {
            resetInactivityTimeout();
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
                var entries = userData.entries();
                entries.splice(entries.indexOf(entry), 1);
                userData.entries(entries, true);
                updateTimestampAndSaveToAllStorage();
            }
        };

        // Copies text to the clipboard or unmasks an element and selects its text
        self.copytext = function (text, element) {
            // clipboardData API only supported by Internet Explorer
            var copySuccess = window.clipboardData && window.clipboardData.setData("Text", text);
            if (!copySuccess) {
                var contentEditable = "contentEditable";
                element.text = text;
                if (self.contentEditableNeeded()) {
                    // Required on iOS Safari to show the selection
                    element.attributes[contentEditable] = true;
                }
                var selection = window.getSelection();
                selection.removeAllRanges();
                var range = document.createRange();
                range.setStart(element, 0); // Note: selectNode API is not as reliable (especially on iOS Safari)
                range.setEnd(element, 1);
                selection.addRange(range);
                // Try to copy to the clipboard
                try {
                    copySuccess = document.execCommand("copy");
                    if (window.clipboardData) {
                        // When permission is denied in IE, execCommand still returns true
                        copySuccess = false;
                    }
                } catch (ignore) {
                    // Treat SecurityError as failure
                }
                var reMaskText = function () {
                    element.attributes[contentEditable] = false;
                    selection.removeAllRanges();
                    var dataMask = element.attributes["data-mask"];
                    element.text = dataMask ? dataMask.value : text;
                };
                if (copySuccess) {
                    // Re-mask text immediately
                    reMaskText();
                } else {
                    // Set a timer to re-mask the text after being copied
                    setTimeout(reMaskText, 10 * 1000); // 10 seconds
                }
            }
            if (copySuccess) {
                var clipboardCopied = " clipboard copied";
                element.className += clipboardCopied;
                setTimeout(function removeCopied() {
                    element.className = element.className.replace(clipboardCopied, "");
                }, 0.2 * 1000); // 0.2 second
            }
        };

        // Returns a serializable representation of the object
        self.toJSON = function () {
            return {
                schema: self.schema,
                timestamp: self.timestamp,
                entries: self.entries()
            };
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
        self.expanded = observable(0);
        self.id = observable();
        self.username = observable();
        self.password = observable();
        self.website = observable();
        self.notes = observable();
        self.populatedFrom = null;
        self.generating = observable();
        self.passwordLength = observable("16");
        self.passwordLower = observable(true);
        self.passwordUpper = observable(true);
        self.passwordNumbers = observable(true);
        self.passwordSymbols = observable(true);

        // Clears the entry form
        self.clear = function () {
            resetInactivityTimeout();
            self.generating(0);
            self.id("");
            self.username("");
            self.password("");
            self.website("");
            self.notes("");
            self.populatedFrom = null;
        };
        self.clear();

        // Returns true if valid (i.e., ID and password present)
        self.isValid = function () {
            return self.id().trim() && self.password();
        };

        // Populates the form by copying fields from an entry
        self.populateFrom = function (entry) {
            self.clear();
            self.id(entry.id);
            self.username(entry.username);
            self.password(entry.password);
            self.website(entry.website);
            self.notes(entry.notes);
            self.populatedFrom = entry;
            self.expand();
        };

        // Creates a new entry after validating the input
        self.submit = function () {
            resetInactivityTimeout();
            if (self.isValid()) {
                var entry = {
                    timestamp: Date.now(),
                    id: self.id().trim(),
                    username: self.username(),
                    password: self.password(),
                    website: self.website(),
                    notes: self.notes().trim(),
                    weak: isWeakPassword(self.password())
                };
                var entries = userData.entries();
                var existing = entries.filter(function (e) {
                    return 0 === entryComparer(e, entry);
                });
                if ((0 === existing.length) || window.confirm("Update existing entry \"" + entry.id + "\"?")) {
                    if (self.populatedFrom &&
                        (0 !== entryComparer(entry, self.populatedFrom)) &&
                        (-1 !== entries.indexOf(self.populatedFrom)) &&
                        window.confirm("Remove previous entry \"" + self.populatedFrom.id + "\"?")) {
                        entries.splice(entries.indexOf(self.populatedFrom), 1);
                    }
                    var index = entries.indexOf(existing[0]);
                    entries.splice(index, (index === -1 ? 0 : 1), entry);
                    entries.sort(entryComparer);
                    userData.entries(entries, true);
                    updateTimestampAndSaveToAllStorage();
                    self.clear();
                    userData.filter("");
                    self.expand(); // Reset focus to first input
                }
            } else {
                // Validation for browsers that don't support HTML validation
                window.alert("Incomplete or invalid entry.");
            }
        };

        // Simulates a click of submit button so browser will run HTML form validation
        self.clickSubmit = function (entry, event) {
            (event.target.submit || event.target.parentNode.submit).click();
        };

        // Expands the entry form
        self.expand = function () {
            resetInactivityTimeout();
            self.expanded(self.expanded() + 1);
        };

        // Generates a random/secure password
        self.generatePassword = function () {
            resetInactivityTimeout();
            if (self.expanded() && (self.generating() || !self.password().length)) {
                var pool = "";
                if (self.passwordLower()) {
                    pool += "abcdefghijklmnopqrstuvwxyz";
                }
                if (self.passwordUpper()) {
                    pool += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                }
                if (self.passwordNumbers()) {
                    pool += "0123456789";
                }
                if (self.passwordSymbols()) {
                    pool += "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
                }
                var password = "";
                if (pool.length) {
                    var i;
                    for (i = 0; i < self.passwordLength() ; i++) {
                        password += (pool[self.getRandomInt(0, pool.length - 1)]);
                    }
                }
                self.password(password);
            }
            self.generating(self.generating() + 1);
        };

        // Subscriptions to re-generate when password settings change
        [self.passwordLength, self.passwordLower, self.passwordUpper, self.passwordNumbers, self.passwordSymbols].forEach(function (observable) {
            observable.subscribe(self.generatePassword, self);
        });

        // Gets a random floating-point number between 0 (inclusive) and 1 (exclusive)
        self.getRandomFloat = function () {
            try {
                // No feature-detection; need to handle QuotaExceededError regardless
                var array = new Uint32Array(1);
                window.crypto.getRandomValues(array);
                return (array[0] & ((1 << 30) - 1)) / (1 << 30);
            } catch (ex) {
                return Math.random();
            }
        };

        // Gets a random integer between min and max (inclusive)
        self.getRandomInt = function (min, max) {
            return Math.floor((self.getRandomFloat() * (max - min + 1)) + min);
        };
    }
    var entryForm = new EntryForm();

    // Enables the main page UI
    var loginPageVisible = observable(true);
    var mainPageVisible = observable(false);
    function enableMainPage(enable) {
        loginPageVisible(false);
        mainPageVisible(enable);
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
                    e.weak = isWeakPassword(e.password);
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

    function changeMasterPassword() {
        // Prompt to change master password
        var newPassPhrase = window.prompt("New master password:", "");
        if (newPassPhrase || ("" === newPassPhrase)) {
            var previousPassPhrase = PassPhrase;
            var previousCredentialHash = getCredentialHash();
            removeFromLocalStorage();
            PassPhrase = newPassPhrase;
            updateTimestampAndSaveToAllStorage(previousCredentialHash, function (success) {
                if (success) {
                    // Success, clean up remote storage
                    removeFromRemoteStorage(previousCredentialHash);
                } else {
                    // Failure, restore old password locally (already unchanged remotely)
                    removeFromLocalStorage();
                    PassPhrase = previousPassPhrase;
                    saveToLocalStorage();
                    status.showError("Master password update failed; password unchanged!");
                }
            });
        }
    }

    // Update data timestamp and save to local/remote
    function updateTimestampAndSaveToAllStorage(previousName, callback) {
        userData.timestamp = Date.now();
        saveToLocalStorage();
        saveToRemoteStorage(previousName, callback);
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
        ajax(
            getRemoteStorageUri(),
            "GET",
            {
                name: getCredentialHash()
            },
            function (responseText) {
                var result = mergeImportedData(responseText, false);
                if (result) {
                    status.showError(result);
                }
            },
            function () {
                var implication = userData.entries().length ? "using local data" : "no local data available";
                var reason = navigatorOnLine() ? "Network problem or bad user name/password?" : "Network appears offline.";
                var message = "Error reading from cloud; " + implication + ". (" + reason + ")";
                status.showError(message);
                logNetworkFailure(message);
            },
            function () {
                status.showProgress(null);
            }
        );
    }

    // Saves data to remote storage
    function saveToRemoteStorage(previousName, callback) {
        status.showProgress("Saving to cloud...");
        var success = true;
        ajax(
            getRemoteStorageUri(),
            "POST",
            {
                method: "PUT",
                name: getCredentialHash(),
                previousName: previousName,
                content: encode(userData)
            },
            null,
            function () {
                var implication = CacheLocally ? "Data was saved locally; cloud will be updated when possible." : "Not caching, so data may be lost when browser is closed!";
                var reason = navigatorOnLine() ? "" : " (Network appears offline.)";
                var message = "Error saving to cloud. " + implication + reason;
                status.showError(message);
                logNetworkFailure(message);
                success = false;
            },
            function () {
                status.showProgress(null);
                if (callback) {
                    callback(success);
                }
            }
        );
    }

    // Removes data from remote storage
    function removeFromRemoteStorage(credentialHash) {
        ajax(
            getRemoteStorageUri(),
            "POST",
            {
                method: "DELETE",
                name: credentialHash
            },
            null,
            function () {
                logNetworkFailure("[Error deleting from cloud.]");
            }
        );
    }

    // Encrypts and compresses all entries
    function encode(data) {
        var json = JSON.stringify(data, ["schema", "timestamp", "entries", "id", "username", "password", "website", "notes"]);
        var base64 = LZString.compressToBase64(json);
        var cipherParams = CryptoJS.AES.encrypt(base64, getEncryptionKey());
        return cipherParams.toString();
    }

    // Decrypts and decompresses all entries
    function decode(data) {
        var cipherParams = CryptoJS.AES.decrypt(data, getEncryptionKey());
        var base64 = cipherParams.toString(CryptoJS.enc.Utf8);
        var json = base64 ? LZString.decompressFromBase64(base64) : "";
        return JSON.parse(json);
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
            return "";
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
        return localStorage && localStorage.getItem(key);
    }
    function localStorageSetItem(key, data) {
        try {
            return localStorage && localStorage.setItem(key, data);
        } catch (ignore) {
            // Ignore failure (ex: private mode)
        }
    }
    function localStorageRemoveItem(key) {
        return localStorage && localStorage.removeItem(key);
    }

    // Safe wrapper for navigator
    function navigatorOnLine() {
      return !window.navigator || navigator.onLine;
    }

    // Logs a network failure message to the console
    function logNetworkFailure(message) {
        consoleLog(message);
        consoleLog("File name: " + getCredentialHash());
    }

    // Logs a message to the console
    function consoleLog(message) {
        if (window.console && window.console.log) {
            window.console.log(message);
        }
    }

    // Creates many entries for testing
    // (function createTestEntries(count) {
    //     var entries = [];
    //     for (var i = 0; i < count; i++) {
    //         var s = i.toString();
    //         entries.push({
    //             id: s,
    //             username:s,
    //             password:s
    //         });
    //     }
    //     userData.entries(entries);
    // })(10000);

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
            answer: "The client is built using HTML, CSS, and JavaScript on top of the React, crypto-js, and lz-string libraries. " +
                "The server's REST API runs on either ASP.NET or Node.js. " +
                "Encryption uses 256-bit AES in CBC mode. " +
                "Hashing uses SHA-512."
        },
    ];

    // Initialize
    render({
        app: {
            loginPageVisible: loginPageVisible,
            mainPageVisible: mainPageVisible,
            changeMasterPassword: changeMasterPassword,
            resetInactivityTimeout: resetInactivityTimeout
        },
        loginForm: loginForm,
        faqs: faqs,
        status: status,
        userData: userData,
        entryForm: entryForm
    });

    // setTimeout call works around an Internet Explorer bug where textarea/placeholder's input event fires asynchronously on load (http://dlaa.me/blog/post/inputplaceholder)
    window.setTimeout(clearInactivityTimeout, 10);
})();
