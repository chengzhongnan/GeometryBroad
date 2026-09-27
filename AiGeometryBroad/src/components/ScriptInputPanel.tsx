import React, { useState, useEffect, useRef } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import Editor, { type Monaco } from '@monaco-editor/react'; // 👈 1. 引入 Monaco 类型
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
import { ALL_META_COMMANDS, GEOMETRIC_COMMANDS } from '../core/dslCommandNames';

interface ScriptInputPanelProps {
  title: string;
  onExecute: (script: string) => void;
  onSave: () => void;
  saveStatus?: string;
  script: string;
  onScriptChange: (newScript: string) => void;
  /**
   * 要在编辑器左侧打出「调试红点」的行号（1-based）。
   *
   * 由父组件从当前选中的对象换算而来 —— 红点的语义是「创建 / 绘制这个对象的代码在哪」，
   * 这个映射只有解释器知道（它渲染时才建立「对象 ⇄ 源码行」的关系），编辑器不去自己解析脚本。
   */
  highlightLines?: number[];
}

// 2. 定义我们的语言 ID
const LANGUAGE_ID = 'geo-script';

// 3. 编写语法高亮的核心逻辑
function setupGeoScriptLanguage(monaco: Monaco) {
  // 防止重复注册
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === LANGUAGE_ID)) {
    return;
  }
  
  // 第一步: 注册语言
  monaco.languages.register({ id: LANGUAGE_ID });

  // 第二步: 定义 Monarch 词法规则
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    ignoreCase: true,
    // 两份清单都从 dslCommandNames.ts 取，不再手抄。手抄的结果就是高亮跟解释器漂移：
    // `TRANSLATE`（没有任何实现）一直被点亮成关键字，而 `REGION` / `AXIS` / `GRID` /
    // `FUNCTION` / `CURVE` / `POINTSET` 这些真指令反倒不会被点亮。
    // 别名（`WITHRUN` / `MESSAGE`）也算，它们写出来是合法的。
    keywords: [...ALL_META_COMMANDS] as string[],
    typeKeywords: [...GEOMETRIC_COMMANDS] as string[],
    operators: ['='],
    symbols: /[=]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      // 👇 --- 核心改动：调整 root 内部的规则顺序 --- 👇
      root: [
        // 1. 注释和占位符规则最特殊，优先匹配
        [/^#.*$/, 'comment'],
        [/\{[a-zA-Z_][\w_]*\}/, 'variable.predefined'],
        
        // 2. 关键：先匹配专门的“参数名”（后面跟着等号的单词）
        [/[a-z_][\w_]*(?=\s*=)/, 'parameter.name'],

        // 3. 然后再匹配通用的“单词”（关键字或标识符）
        [/[a-zA-Z][\w_]*/, { 
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type.keyword',
            '@default': 'identifier'
          }
        }],
        
        // 4. 最后匹配操作符
        [/[=]/, 'operator', '@value'],
      ],

      value: [
        [/[a-zA-Z_][\w_]*/, 'string.value', '@pop'],
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number', '@pop'],
        [/\d+/, 'number', '@pop'],
        [/\{[a-zA-Z_][\w_]*\}/, 'variable.predefined', '@pop'],
        [/\s+/, '', '@pop'],
        [/$/, '', '@pop'],
      ],
    },
  });

  // 第三步: 定义自定义主题，将 token 映射到颜色
  monaco.editor.defineTheme('geo-script-theme', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'C586C0' }, // 紫色 (VIEW, CREATE)
      { token: 'type.keyword', foreground: '4EC9B0' }, // 青色 (POINT, CIRCLE)
      { token: 'parameter.name', foreground: '9CDCFE' }, // 浅蓝色 (name, x, y)
      { token: 'variable.predefined', foreground: 'CE9178' }, // 橙色 ({slot_r})
      { token: 'comment', foreground: '6A9955' }, // 绿色 (# 注释)
      { token: 'number', foreground: 'B5CEA8' }, // 浅绿色 (数字)
      { token: 'operator', foreground: 'D4D4D4' }, // 白色 (=)
      { token: 'identifier', foreground: 'D4D4D4' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'string.value', foreground: 'CE9178' }
    ],
    colors: {}
  });
}

const initialScript = ``;

/**
 * 红点的视觉尺寸。
 *
 * 10px 是按常见 monaco 行高（~19px）挑的：够醒目，又不会顶满行高显得笨重。
 */
const GLYPH_DOT_SIZE = 10;

// 装饰的 class 名。Monaco 会把 `glyphMarginClassName` 加到一个 `div.cgmr` 上，
// 那个 div 由 Monaco 自己写成：
//
//   .glyph-margin-widgets .cgmr { position: absolute; display: flex;
//                                 align-items: center; justify-content: center; }
//
// 而且 JS 里会把它的 width / height 设成**固定值**（width = 字形边距宽度，
// height = 行高，见 glyphMargin.js 的 setWidth/setHeight）。这两点决定了画法：
//
//   - 因为已经有 `display:flex` + 双向居中，红点只要是个**不带定位**的方块，
//     就会被自动摆在正中。所以不要写 position:absolute / top / left —— 那样反而
//     要自己算居中，还会在行高变化时错位。
//   - 因为 width / height 是固定值、不是 auto，所以不能指望「把 red 直接当方块画」：
//     直接给 .cgmr 上背景色会染满整个边距格子。必须画在 ::after 这个子元素上。
const DOT_CLASS = 'geo-def-line-dot';

/**
 * 红点样式。
 *
 * **必须用 `createGlobalStyle`，不能用普通 styled 组件。**
 * styled-components 会把规则写成 `.生成类名 .geo-def-line-dot { ... }` 这种**后代选择器**，
 * 而红点所在的那个 `div.cgmr` 是 **Monaco 在它自己的 DOM 子树里造出来的**
 * （`.monaco-editor .glyph-margin-widgets` 下面），根本不在本组件的 DOM 里 ——
 * 后代选择器永远匹配不上，`::after` 的 `content` 会一直是 `none`，红点根本不显示。
 * 实测确认过这一点，所以这里改用全局样式，只用那个够特殊的类名做限定。
 *
 * 为什么选 `createGlobalStyle` 而不是往 Monaco 里注入或在别处挂一个宿主 div：
 * 全局样式只影响 `.geo-def-line-dot` 这一个类，类名是独有的，不会污染 Monaco 自身的样式；
 * 而且它跟着组件一起挂载 / 卸载，编辑器不在时也不残留。
 */
const GlyphStyles = createGlobalStyle`
  /* Monaco 会把 glyphMarginClassName 加到一个 div.cgmr 上，那个 div 由 Monaco 写成：
   *
   *   .glyph-margin-widgets .cgmr { position: absolute; display: flex;
   *                                 align-items: center; justify-content: center; }
   *
   * 并且 JS 里把它的 width / height 设成**固定值**（width = 字形边距宽度，
   * height = 行高，见 glyphMargin.js 的 setWidth/setHeight）。这两点决定了画法：
   *
   *   - 已经自带 flex + 双向居中，所以红点只要是个**不带定位**的方块就会被摆到正中。
   *     不要写 position:absolute / top / left —— 那要自己算居中，行高一变就错位。
   *   - width / height 是固定值、不是 auto，所以不能直接给 .cgmr 上背景色，
   *     那会把整个边距格子染红。必须画在 ::after 这个子元素上。
   */
  .${DOT_CLASS} {
    position: relative;
  }
  .${DOT_CLASS}::after {
    content: '';
    display: block;
    width: ${GLYPH_DOT_SIZE}px;
    height: ${GLYPH_DOT_SIZE}px;
    border-radius: 50%;
    background-color: #ff4d4f;
    /* 描一圈深色边：暗色主题下纯红压在深色背景上容易糊成一团。 */
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    /* 红点是纯提示，别抢走 glyph margin 上的鼠标事件（点它不该有反应）。 */
    pointer-events: none;
  }
`;

const ScriptInputPanel: React.FC<ScriptInputPanelProps> = ({
  script,
  onScriptChange,
  onExecute,
  onSave,
  saveStatus,
  highlightLines,
}) => {
  // 4. 使用 onMount 回调来设置语言和主题
  function handleEditorWillMount(monaco: Monaco) {
    setupGeoScriptLanguage(monaco);
  }

  // ---- 定义行红点 ----
  // 编辑器和 monaco 实例都存在 ref 里，装饰集合也留着，随时可以重算。
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);

  // 每次都重建整组装饰，而不是去 diff。
  // 理由：一个对象可能同时对应好几行（定义行 + DRAW 行），行号还会因为用户改脚本
  // 而整体位移；delta 计算容易漏掉「先删后加」的情况，直接重建反而更短也更稳。
  const applyHighlight = (monaco: Monaco, editor: MonacoEditor.IStandaloneCodeEditor, lineNumbers: number[]) => {
    const model = editor.getModel();
    if (!model) return;

    // 越界行号直接丢掉：脚本刚被改成更短时，父组件传下来的行号可能还没更新。
    const lineCount = model.getLineCount();
    const decorations = lineNumbers
      .filter(line => Number.isInteger(line) && line >= 1 && line <= lineCount)
      .map(line => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          // 只打 glyph margin 上的点，不碰行内文字、也不改行背景 ——
          // 编辑器里既有语法高亮又有语法检查的 squiggle，再加背景色会看不清代码。
          glyphMarginClassName: DOT_CLASS,
          glyphMarginHoverMessage: { value: '该对象的创建 / 绘制代码' },
        },
      }));

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditorMount = (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyHighlight(monaco, editor, highlightLines ?? []);
  };

  // 选中对象变了 → 重算红点。
  // 依赖里带 script 是必要的：行号是按**当前**脚本算的，用户一改脚本行号就可能整体位移，
  // 而父组件传下来的 highlightLines 有可能还没跟上（它对 script 的更新有一帧延迟），
  // 所以内容一变就顺手重算一次，避免红点短暂停在旧行上。
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    applyHighlight(monaco, editor, highlightLines ?? []);
  }, [highlightLines, script]);

  // 组件卸载时把 ref 清掉，避免 useEffect 在已销毁的编辑器上再跑一次。
  useEffect(() => () => {
    editorRef.current = null;
    monacoRef.current = null;
    decorationIdsRef.current = [];
  }, []);

  const handleExecuteClick = (): void => {
    onExecute(script);
  };

  return (
    <>
      <GlyphStyles />
      <EditorWrapper>
        <Editor
          height="100%"
          language={LANGUAGE_ID} // 使用我们注册的语言 ID
          theme="geo-script-theme" // 使用我们定义的主题
          value={script}  // 使用 props 中的 script 作为编辑器的值
          onChange={(value) => onScriptChange(value || '')} // onChange 事件调用 props 中的 onScriptChange 来通知父组件更新
          beforeMount={handleEditorWillMount} // 关键：在编辑器挂载时执行设置着色规则
          onMount={handleEditorMount}
          options={{
            padding: {
              top: 16,
              bottom: 16,
            },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: 14,
            minimap: { enabled: false },
            // 打开字形边距：定义行红点就画在这一条上。
            // 它默认是关的，必须显式打开，否则 glyphMarginClassName 无处可画。
            glyphMargin: true,
            // 如果不需要代码折叠，可以关闭，这会进一步减少边距
            folding: false,
            // 明确设置行装饰（如git变更状态）的边距为0
            lineDecorationsWidth: 15,
            // 设置行号的最小字符宽度，减小它会缩短行号和代码的间距
            lineNumbersMinChars: 3,
          }}
        />
      </EditorWrapper>
      <ButtonWrapper>
        <ExecuteButton onClick={handleExecuteClick}>
          Execute Script
        </ExecuteButton>
        <SaveScriptButton onClick={onSave}>
          Save Script
        </SaveScriptButton>
        {saveStatus && <SaveStatus role="status">{saveStatus}</SaveStatus>}
      </ButtonWrapper>
    </>
  );
};

// --- Styles (保持不变) ---
const EditorWrapper = styled.div`
  flex-grow: 1;
  width: 100%;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  margin-bottom: 1rem;
  overflow: hidden;

  &:focus-within {
    border-color: #6c5ce7;
    box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.2);
  }
`;

const ButtonWrapper = styled.div`
  display: flex;
  gap: 10px; /* 设置按钮之间的间距 */
  flex: 1;
`;

const ExecuteButton = styled.button`
  flex: 1; /* 让按钮平均分配空间 */
  padding: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: #ffffff;
  background-color: #6c5ce7;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #5849be;
  }
`;

const SaveStatus = styled.span`
  align-self: center;
  color: #5f6b7a;
  font-size: 0.85rem;
  white-space: nowrap;
`;

const SaveScriptButton = styled.button`
  flex: 1; /* 让按钮平均分配空间 */
  padding: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: #ffffff;
  background-color: #6c5ce7;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #5849be;
  }
`;

export default ScriptInputPanel;
