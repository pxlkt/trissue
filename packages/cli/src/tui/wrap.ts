import stringWidth from "string-width";

/** Wraps text to a width in terminal cells, breaking at spaces where it can. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  const limit = Math.max(width, 1);
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === "") continue;
      const wordWidth = stringWidth(word);
      if (lineWidth + wordWidth <= limit) {
        line += word;
        lineWidth += wordWidth;
        continue;
      }
      if (/^\s+$/.test(word)) {
        out.push(line);
        line = "";
        lineWidth = 0;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      lineWidth = 0;
      // A word longer than the line is split by cells.
      let rest = word;
      while (stringWidth(rest) > limit) {
        let cut = "";
        for (const char of rest) {
          if (stringWidth(cut + char) > limit) break;
          cut += char;
        }
        out.push(cut);
        rest = rest.slice(cut.length);
      }
      line = rest;
      lineWidth = stringWidth(rest);
    }
    out.push(line.trimEnd());
  }
  return out;
}
