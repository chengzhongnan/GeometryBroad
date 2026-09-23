import React, { useState } from 'react';
import styled from 'styled-components';
import Editor, { type Monaco } from '@monaco-editor/react'; // 👈 1. 引入 Monaco 类型

interface ScriptInputPanelProps {
  title: string;
  onExecute: (script: string) => void;
  onSave: () => void;
  saveStatus?: string;
  script: string;
  onScriptChange: (newScript: string) => void;
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
    keywords:  ['CLEAR', 'SET', 'HELP', 'VIEW', 'TRANSLATE', 'DRAW', 'TEXT', 'MEASURE', 'RUN', 'CODE', 'WITH', 'CALCULATE', 'GETOBJ', 'PRINT', 'CREATE'],
    typeKeywords: [
      'POINT', 'LINE', 'SEGMENT', 'RAY', 'MIDPOINT', 'PERPENDICULAR_FOOT', 'REFLECTED_POINT', 'ROTATED_POINT',
      'INTERSECT', 'POINT_ON_LINE', 'PERP_BISECTOR', 'PERPENDICULAR', 'PARALLEL', 'ANGLE_BISECTOR', 'CIRCUMCIRCLE',
      'INCIRCLE', 'TANGENT', 'POLYGON', 'TRIANGLE', 'RECTANGLE', 'CIRCLE', 'ELLIPSE', 'PARABOLA', 'HYPERBOLA',
      'ANGLE', 'FOCIS', 'RANDOMPOINT', 'SLOT', 'ANIMATION'],
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

const ScriptInputPanel: React.FC<ScriptInputPanelProps> = ({ script, onScriptChange, onExecute, onSave, saveStatus }) => {
  
  // 4. 使用 onMount 回调来设置语言和主题
  function handleEditorWillMount(monaco: Monaco) {
    setupGeoScriptLanguage(monaco);
  }

  const handleExecuteClick = (): void => {
    onExecute(script);
  };

  return (
    <>
      <EditorWrapper>
        <Editor
          height="100%"
          language={LANGUAGE_ID} // 使用我们注册的语言 ID
          theme="geo-script-theme" // 使用我们定义的主题
          value={script}  // 使用 props 中的 script 作为编辑器的值
          onChange={(value) => onScriptChange(value || '')} // onChange 事件调用 props 中的 onScriptChange 来通知父组件更新
          beforeMount={handleEditorWillMount} // 关键：在编辑器挂载时执行设置着色规则
          options={{
            padding: {
              top: 16,
              bottom: 16,
            },
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: 14,
            minimap: { enabled: false },
            // 关闭字形边距 (行号左侧的空白)
            glyphMargin: false,
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
