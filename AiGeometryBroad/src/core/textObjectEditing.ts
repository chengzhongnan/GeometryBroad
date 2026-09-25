// TEXT 对象（画布上的文字）的「读回」与「改写」。
//
// 为什么单独开一个文件而不是塞进 dslObjectEditing.ts：
// TEXT 和几何对象在脚本里的形态**根本不同** —— 几何对象有 `name=`，删除/属性改写都靠
// 「按名字找到定义行」；而 TEXT 是匿名的站点式指令（`TEXT x=.. y=.. text=".."`），
// 解释器给它的是内部合成的名字 `text_<行号>`。两条路径的定位方式完全不同，
// 混在一个文件里只会让「你以为在改名字，其实在改行号」这种误读发生。
//
// 这里的函数都是纯函数：输入脚本 / 单行文本，输出文本，不碰 DOM、不碰解释器状态。

import type { CreateTextSpec } from './geometryCommandBuilder';

/**
 * 反转义 `text="..."` 里被转义的内容。
 *
 * 必须和 `geometryCommandBuilder.escapeTextContent` 严格互逆，否则会出现
 * 「打开对话框看到的和画布上的不一样」：
 *   `\` → `\\`、`"` → `\"`、换行 → `\n`
 * 反过来的还原只认这三种，其余反斜杠（LaTeX 的 `\frac` 之类）原样保留 ——
 * 这正是 `DSLInterpreter.executeText` 里那条规则，两处必须一致。
 */
export function unescapeTextContent(escaped: string): string {
    let result = '';
    for (let i = 0; i < escaped.length; i++) {
        const ch = escaped[i];
        if (ch !== '\\') {
            result += ch;
            continue;
        }
        const next = escaped[i + 1];
        if (next === 'n') {
            result += '\n';
            i++;
        } else if (next === 't') {
            result += '\t';
            i++;
        } else if (next === 'r') {
            result += '\r';
            i++;
        } else if (next === '"' || next === "'" || next === '\\') {
            result += next;
            i++;
        } else {
            // 未知转义（含 LaTeX 命令）原样保留反斜杠。
            result += ch;
        }
    }
    return result;
}

/**
 * 从一行脚本里解析出 TEXT 的内容与样式。
 *
 * 返回 null 表示这行不是一条能编辑的 TEXT 指令（没写 `text=`、或内容跨行）。
 *
 * 这里**不**复用解释器的 `parseParameters`：那是解释器内部的私有扫描器
 * （要处理 `{}` 槽位、后向引用、动画上下文）。但 TEXT 的文本参数有个特殊之处 ——
 * 它会一直吃到下一个已知参数为止，所以正则必须和 `executeText` 里的
 * `textMatch` **保持同一份参数名表**，否则「解释器这样切、编辑对话框那样切」，
 * 用户一改就把内容切坏了。
 */
export function parseTextCommandLine(line: string): CreateTextSpec | null {
    if (!/^\s*(?:CREATE\s+)?TEXT\b/i.test(line)) return null;

    const textMatch = /\b(?:text|t)=([\s\S]*?)(?=\s+(?:color|c|fontSize|fs|fontFamily|font|fontStyle|fontWeight|backgroundColor|bgc|padding|p)=|$)/i.exec(line);
    if (!textMatch) return null;

    const rawText = textMatch[1].trim();
    const quoted = (rawText.startsWith('"') && rawText.endsWith('"'))
        || (rawText.startsWith("'") && rawText.endsWith("'"));
    const content = quoted ? unescapeTextContent(rawText.slice(1, -1)) : rawText;

    const num = (key: string): number | undefined => {
        const match = new RegExp(`\\b${key}=(-?[\\d.]+)`, 'i').exec(line);
        return match ? Number(match[1]) : undefined;
    };
    const str = (key: string): string | undefined => {
        const match = new RegExp(`\\b${key}=("[^"]*"|'[^']*'|[^\\s]+)`, 'i').exec(line);
        if (!match) return undefined;
        const value = match[1];
        return value.startsWith('"') || value.startsWith("'")
            ? value.slice(1, -1)
            : value;
    };
    const flag = (key: string): boolean => new RegExp(`\\b${key}=true\\b`, 'i').test(line);

    return {
        content,
        fontSize: num('fontSize') ?? num('fs') ?? 16,
        color: str('color') ?? str('c') ?? '#1f2937',
        fontFamily: str('fontFamily') ?? str('font') ?? 'Arial',
        italic: /fontStyle\s*=\s*italic/i.test(line),
        bold: /fontWeight\s*=\s*bold/i.test(line),
        backgroundColor: str('backgroundColor') ?? str('bgc') ?? '',
        padding: num('padding') ?? num('p') ?? 4,
    };
}

/**
 * 判断某一行是不是一条**完整**（没有跨行引号）的 TEXT 指令。
 *
 * 跨行引号（`text="第一行\n第二行"` 里真的敲了回车）会让「改这一行」变成
 * 「改半条指令」，所以遇到就放弃改写 —— 交给用户自己在脚本里改。
 */
function isSingleLineCommand(line: string): boolean {
    if (line.endsWith('\\')) return false;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "'" && !inDouble) inSingle = !inSingle;
    }
    return !inSingle && !inDouble;
}

/** 找行尾注释起点（忽略颜色值里的 `#`，也忽略引号里的内容）。 */
function findCommentStart(line: string): number {
    let quote: '"' | "'" | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = null;
            if (ch === '\\') i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch === '"' ? '"' : "'";
            continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
    }
    return line.length;
}

/**
 * 把用户填的内容与样式**原地**写回一行 TEXT 指令。
 *
 * 形状必须和 `buildCreateShapeCommands` 生成的一致：`TEXT x=.. y=.. <样式...> text=".."`，
 * 内容排最后（DSL 的 `text=` 会一直吃到行尾）。否则「新建的文字」和「编辑后保存的文字」
 * 在脚本里长得不一样，用户会以为出了问题。
 *
 * `x=` / `y=` 直接从原行**原样搬过来**，不重新格式化：编辑改的是内容和样式，
 * 坐标没动，没理由把用户自己写的 `x=-365` 重排成别的写法。原行没有 x/y
 * （比如靠 `name=` 引用别处的坐标）时也不强行补，保持原样。
 *
 * 返回 null 表示这行不适合改写（不是 TEXT / 内容为空 / 跨行 / 引号未闭合）。
 */
export function rewriteTextCommandLine(line: string, spec: CreateTextSpec): string | null {
    if (!/^\s*(?:CREATE\s+)?TEXT\b/i.test(line)) return null;
    if (spec.content.trim() === '') return null;
    if (!isSingleLineCommand(line)) return null;

    const escaped = spec.content
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r\n|\r|\n/g, '\\n');

    // 头部固定部分：`TEXT` + 原有的 x/y（含别名 `cx`/`cy` 之类只认 x/y，
    // TEXT 的标准写法就是 x/y，别的参数不搬）。
    const xMatch = /\bx=("[^"]*"|'[^']*'|[^\s]+)/i.exec(line);
    const yMatch = /\by=("[^"]*"|'[^']*'|[^\s]+)/i.exec(line);
    if (!xMatch || !yMatch) return null;
    const head = `TEXT x=${xMatch[1]} y=${yMatch[1]}`;

    const parts: string[] = [];
    if (Number.isFinite(spec.fontSize) && spec.fontSize > 0) parts.push(`fontSize=${spec.fontSize}`);
    if (spec.color) parts.push(`color=${spec.color}`);
    if (spec.fontFamily) parts.push(`fontFamily="${spec.fontFamily}"`);
    if (spec.italic) parts.push('fontStyle=italic');
    if (spec.bold) parts.push('fontWeight=bold');
    if (spec.backgroundColor) parts.push(`backgroundColor=${spec.backgroundColor}`);
    if (spec.backgroundColor && Number.isFinite(spec.padding) && spec.padding > 0) {
        parts.push(`padding=${spec.padding}`);
    }
    parts.push(`text="${escaped}"`);

    // 行尾注释保留在最后，别把它卷进内容里。
    const commentStart = findCommentStart(line);
    const comment = commentStart < line.length ? line.slice(commentStart).trim() : '';
    return comment ? `${head} ${parts.join(' ')} ${comment}` : `${head} ${parts.join(' ')}`;
}

/**
 * 从脚本里删掉某一行 TEXT 指令。
 *
 * TEXT 没有 `name=`，通用删除路径（`removeObjectsFromScript`）按名字找不到它，
 * 所以需要这个按行号删的专用入口。返回 null 表示行号越界或那行不是完整 TEXT。
 */
export function removeTextLineFromScript(script: string, lineNumber: number): string | null {
    const lines = script.split('\n');
    const index = lineNumber - 1;
    if (index < 0 || index >= lines.length) return null;
    if (!/^\s*(?:CREATE\s+)?TEXT\b/i.test(lines[index])) return null;
    if (!isSingleLineCommand(lines[index])) return null;
    return lines.filter((_, i) => i !== index).join('\n');
}
