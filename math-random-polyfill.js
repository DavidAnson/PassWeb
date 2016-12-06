// math-random-polyfill.js
// https://github.com/DavidAnson/math-random-polyfill
// 2016-12-03

(function iife () {
  "use strict";
  // Feature detection
  var crypto = window.crypto || window.msCrypto;
  if (window.Uint32Array && crypto && crypto.getRandomValues) {
    // Capture functions and values
    var Math_random = Math.random.bind(Math);
    var crypto_getRandomValues = crypto.getRandomValues.bind(crypto);
    var MAX_SAFE_INTEGER = Math.pow(2, 53) - 1;
    var highShift = Math.pow(2, 32);
    var highMask = Math.pow(2, 53 - 32) - 1;
    // Polyfill Math.random
    Math.random = function math_random_polyfill () {
      try {
        // Get random bits for numerator
        var array = new Uint32Array(2);
        crypto_getRandomValues(array);
        var numerator = ((array[0] & highMask) * highShift) + array[1];
        // Divide by maximum-value denominator
        var denominator = MAX_SAFE_INTEGER + 1;
        return numerator / denominator;
      } catch (ex) {
        // Exception in crypto.getRandomValues, fall back to Math.random
        return Math_random();
      }
    };
  }
}());
