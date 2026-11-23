/*
 * Reading the app's JavaScript as code, for the checks (development only, not shipped).
 *
 *   var scan = require('./lib/scan.js');
 *   scan.blank(src) -> { code, templates }   the source with every string, comment and regular
 *                                            expression turned to spaces (newlines kept, so lines
 *                                            still count), and the template strings it met
 *   scan.members(src, name) -> ['nTop', ...] the members read or called on `name.` in code
 *
 * No parser: a scan that knows where a regular expression can begin (after an operator, an
 * opening bracket or a keyword such as return), and nothing else of the grammar.
 */
'use strict';

/**
 * src with every string, comment and regular expression literal turned to spaces (newlines
 * kept, so lines still count), and the template strings it met: [{ line }].
 */
function blank(src) {
  var out = src.split(''), n = src.length, i = 0, prev = '', templates = [];
  function line(at) { return src.slice(0, at).split('\n').length; }
  function wipe(a, b) { for (var k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; }
  var KW = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  while (i < n) {
    var c = src[i], d = src[i + 1], j;
    if (c === '/' && d === '/') { j = src.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
    if (c === '/' && d === '*') { j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      if (c === '`') templates.push({ line: line(i) });
      for (j = i + 1; j < n && src[j] !== c; j++) { if (src[j] === '\\') j++; else if (src[j] === '\n' && c !== '`') break; }
      wipe(i, j + 1); i = j + 1; prev = 'v'; continue;
    }
    if (c === '/') {
      // a regular expression where an expression can begin; else division
      var expr = prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || KW.test(prev);
      if (expr) {
        var cls = false;
        for (j = i + 1; j < n; j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === '\n') break;
          if (cls) { if (src[j] === ']') cls = false; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === '/') break;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        wipe(i, j); i = j; prev = 'v'; continue;
      }
      prev = '/'; i++; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      for (j = i; j < n && /[\w$]/.test(src[j]); j++);
      prev = src.slice(i, j); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      for (j = i; j < n && /[\w.]/.test(src[j]); j++);
      prev = 'v'; i = j; continue;
    }
    if (!/\s/.test(c)) prev = c === ')' || c === ']' || c === '}' ? 'v' : c;
    i++;
  }
  return { code: out.join(''), templates: templates };
}
/** The members used on `name.` in the code of src (strings and comments are not code), sorted. */
function members(src, name) {
  var code = blank(src).code, seen = {}, m, re = new RegExp('(?<![.\\w$])' + name + '\\.([A-Za-z_$][\\w$]*)', 'g');
  while ((m = re.exec(code))) seen[m[1]] = true;
  return Object.keys(seen).sort();
}

module.exports = { blank: blank, members: members };
