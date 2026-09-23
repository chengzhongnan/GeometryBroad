// 把含 LaTeX 片段的文本切成普通片段和 LaTeX 片段，供 DSL TEXT 指令和
// OutputPanel 的日志渲染共用，避免两处正则分叉。

export interface LatexTextPart {
    kind: 'text' | 'latex';
    value: string;
    // 仅当 kind === 'latex' 时有值：true 表示 `$$...$$` / `\[...\]`，
    // false 表示 `$...$` / `\(...\)`。
    displayMode?: boolean;
    // 仅当 kind === 'latex' 时有值：包含定界符的原文，便于原样拼回。
    raw?: string;
}

// 匹配顺序：先长优先，再短。
//   $$...$$   \(...\)  \[...\]   \[...\]   $...$
// `$...$` 不允许换行；其余四种允许换行。
const LATEX_DELIMITER =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\$)\$(?!\$)[^$\n]+?\$(?!\$))/g;

export function splitLatexParts(message: string): LatexTextPart[] {
    const parts: LatexTextPart[] = [];
    if (!message) {
        return [{ kind: 'text', value: '' }];
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    LATEX_DELIMITER.lastIndex = 0;
    while ((match = LATEX_DELIMITER.exec(message)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: 'text', value: message.slice(lastIndex, match.index) });
        }
        const token = match[0];
        const startsWithDollarDollar = token.startsWith('$$');
        const startsWithBracket = token.startsWith('\\[');
        const displayMode = startsWithDollarDollar || startsWithBracket;
        let latex: string;
        if (startsWithDollarDollar) {
            latex = token.slice(2, -2);
        } else if (startsWithBracket) {
            latex = token.slice(2, -2);
        } else if (token.startsWith('\\(')) {
            latex = token.slice(2, -2);
        } else {
            latex = token.slice(1, -1);
        }
        parts.push({ kind: 'latex', value: latex, displayMode, raw: token });
        lastIndex = match.index + token.length;
    }
    if (lastIndex < message.length) {
        parts.push({ kind: 'text', value: message.slice(lastIndex) });
    }
    if (parts.length === 0) {
        parts.push({ kind: 'text', value: message });
    }
    return parts;
}

// 返回一个逐字符的布尔掩码：true 表示该字符落在 LaTeX 定界符内部（含定界符本身）。
// `extractExpressions` 用它跳过 LaTeX 里的 `{}`，
// 否则 `\frac{a}{b}` 中的 `{a}` 会被当成槽位表达式去求值。
export function latexRegionMask(text: string): boolean[] {
    const mask = new Array<boolean>(text.length).fill(false);
    LATEX_DELIMITER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LATEX_DELIMITER.exec(text)) !== null) {
        const end = Math.min(match.index + match[0].length, text.length);
        for (let i = match.index; i < end; i++) {
            mask[i] = true;
        }
    }
    return mask;
}