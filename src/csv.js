function csvCell(value) {
  let s = String(value ?? '');
  // Neutralize spreadsheet formula injection: a cell a spreadsheet would
  // evaluate (starts with = + - @ tab CR) gets a leading apostrophe — but
  // never mangle legitimate negative numbers like -5 or -1.2.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

module.exports = { csvCell };