const PATTERN = /^-\s*(.+-.+-.+|.+-.+)；$/;

/** @param {string} text @returns {string[]} empty = pass */
export function validate(text) {
  const errors = [];
  const rawLines = text.split("\n");
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const stripped = raw.replace(/\r$/, "").trimEnd();
    if (stripped.trim() === "") continue;
    if (raw.endsWith("\r")) errors.push("内容包含 \\r 字符，请使用 LF 换行符（而非 CRLF）");
    if (raw !== raw.trim() && raw.trim() !== "") errors.push(`第 ${i + 1} 行首尾有多余空白字符`);
    lines.push({ text: stripped, lineNo: i + 1 });
  }

  if (lines.length === 0) {
    errors.push("输出不能为空");
    return errors;
  }

  for (const { text: line, lineNo } of lines) {
    if (!PATTERN.test(line)) {
      errors.push(`第 ${lineNo} 行格式错误: ${JSON.stringify(line)}`);
      if (!line.startsWith("- ")) errors.push(`  → 应以 "- " 开头`);
      if (!line.endsWith("；")) {
        const last = line.length > 0 ? JSON.stringify(line[line.length - 1]) : '""';
        errors.push(`  → 应以中文分号 "；" 结尾，当前结尾: ${last}`);
      }
      continue;
    }

    const body = line.replace(/^-\s*/, "").replace(/；$/, "");
    const parts = body.split("-");
    let project, module, work;
    if (parts.length >= 3) {
      project = parts[0];
      module = parts[1];
      work = parts.slice(2).join("-");
    } else {
      project = parts[0];
      module = null;
      work = parts[1];
    }

    if (!project.trim()) errors.push(`第 ${lineNo} 行项目名称为空: ${JSON.stringify(line)}`);
    if (module !== null && !module.trim()) errors.push(`第 ${lineNo} 行业务模块为空: ${JSON.stringify(line)}`);
    if (!work.trim()) errors.push(`第 ${lineNo} 行工作内容为空: ${JSON.stringify(line)}`);
  }

  return errors;
}
