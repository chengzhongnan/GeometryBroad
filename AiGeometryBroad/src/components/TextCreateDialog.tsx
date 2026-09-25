import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { splitLatexParts } from '../core/latexSplit';
import type { CreateTextSpec } from '../core/geometryCommandBuilder';
import {
    Backdrop,
    DraggablePanel,
    DragHandle,
    Header,
    Title,
    CloseButton,
    Hint,
    Footer,
    GhostButton,
    PrimaryButton,
    PreviewLabel,
    CodePreview,
    useDragOffset,
} from './DialogChrome';

export interface TextCreateDialogProps {
    /** 文字落脚点的逻辑坐标，只用于显示与生成指令。 */
    anchor: { x: number; y: number };
    /** 将要插入的 TEXT 指令（内容为空时为空串）。 */
    command: string;
    /** 打开对话框时的初始值。 */
    initialValue: CreateTextSpec;
    /**
     * 编辑已有文字时传入，用于切换标题 / 按钮文案。
     * 不传（或传 'create'）就是「插入文字」的既有行为 —— 两个场景共用同一套表单，
     * 只有措辞和提交语义不同，没必要抄一份组件。
     */
    mode?: 'create' | 'edit';
    onCancel: () => void;
    onSubmit: (value: CreateTextSpec) => void;
}

const COLOR_PRESETS = [
    { value: '#1f2937', label: '黑' },
    { value: '#dc2626', label: '红' },
    { value: '#2563eb', label: '蓝' },
    { value: '#16a34a', label: '绿' },
    { value: '#9333ea', label: '紫' },
    { value: '#ea580c', label: '橙' },
];

const FONT_FAMILIES = [
    { value: 'Arial', label: 'Arial' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Courier New', label: 'Courier New' },
    { value: 'SimSun', label: '宋体' },
    { value: 'Microsoft YaHei', label: '微软雅黑' },
    { value: 'KaiTi', label: '楷体' },
];

/**
 * 支持 `$LaTeX$` 的文本预览。
 *
 * 与 `OutputPanel` 里的 `RenderedMessage` 同一套切分逻辑（`splitLatexParts`）：
 * 预览要是用另一套写法，就会出现「预览正常、确定后画布上不一样」的分叉。
 * `throwOnError: false` 让写错的公式红字显示而不是把对话框炸掉。
 */
const LatexPreview: React.FC<{ text: string }> = ({ text }) => (
    <>
        {splitLatexParts(text).map((part, index) => {
            if (part.kind === 'text') {
                // 空行也要占高，否则边上输入框里有空行、预览里却被吃掉。
                return <React.Fragment key={`text-${index}`}>{part.value}</React.Fragment>;
            }
            try {
                const html = katex.renderToString(part.value, {
                    displayMode: part.displayMode === true,
                    throwOnError: false,
                    strict: 'ignore',
                });
                return <span key={`latex-${index}`} dangerouslySetInnerHTML={{ __html: html }} />;
            } catch {
                return <React.Fragment key={`fallback-${index}`}>{part.raw ?? part.value}</React.Fragment>;
            }
        })}
    </>
);

/**
 * 「在此处创建 → 文字」的输入与渲染对话框。
 *
 * 为什么要有这个对话框：TEXT 指令内容里可以混 `$LaTeX$`、换行和样式参数，
 * 直接让用户在脚本里手写、再靠重跑来确认效果，试错成本高。这里左边输入右边实时渲染，
 * 底下还能看到真正将要插入的那一条指令 —— 所见即所得，也看得见要写进脚本的是什么。
 */
const TextCreateDialog: React.FC<TextCreateDialogProps> = ({
    anchor,
    command,
    initialValue,
    mode = 'create',
    onCancel,
    onSubmit,
}) => {
    const [spec, setSpec] = useState<CreateTextSpec>(initialValue);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isEdit = mode === 'edit';
    // 标题栏可拖动：输入文字时经常要参照画布上的图形，对话框挡住关键位置就得能挪开。
    const { offset, dragHandleProps } = useDragOffset();

    // 打开就聚焦到内容框：这个对话框 99% 的操作就是「打字然后回车」。
    useEffect(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
    }, []);

    const update = <K extends keyof CreateTextSpec>(key: K, value: CreateTextSpec[K]) =>
        setSpec(previous => ({ ...previous, [key]: value }));

    const isEmpty = spec.content.trim() === '';
    // 内容为空就不该让人点确定 —— 生成一条 `TEXT ... text=""` 在画布上什么都看不见。
    const canSubmit = !isEmpty;

    const handleKeyDown = (event: React.KeyboardEvent) => {
        // Esc 一律取消。Enter 只有**不按修饰键**且焦点不在多行输入框里时才当「确定」：
        // 否则用户没法在内容里换行（多行是这个对话框的正当需求）。
        if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (canSubmit) onSubmit(spec);
        }
    };

    // 预览区用的字体：把粗体/斜体并进 font 简写，字号也用上，尽量贴近画布效果。
    const previewStyle: React.CSSProperties = useMemo(() => ({
        fontFamily: spec.fontFamily || 'Arial',
        fontSize: `${Math.max(10, Math.min(40, spec.fontSize))}px`,
        fontStyle: spec.italic ? 'italic' : 'normal',
        fontWeight: spec.bold ? 'bold' : 'normal',
        color: spec.color || '#1f2937',
        background: spec.backgroundColor || 'transparent',
        padding: spec.backgroundColor ? `${Math.max(0, spec.padding)}px` : 0,
    }), [spec.fontFamily, spec.fontSize, spec.italic, spec.bold, spec.color, spec.backgroundColor, spec.padding]);

    return createPortal(
        <Backdrop onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
            <WidePanel
                role="dialog"
                aria-modal="true"
                aria-label={isEdit ? '编辑文字' : '插入文字'}
                onKeyDown={handleKeyDown}
                style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
            >
                <DragHandle {...dragHandleProps}>
                    <Header>
                        <Title>{isEdit ? '编辑文字' : '插入文字'}</Title>
                        <CloseButton type="button" onClick={onCancel} aria-label="关闭">×</CloseButton>
                    </Header>
                </DragHandle>

                <Hint>
                    {isEdit
                        ? '修改这段文字的内容或样式，确定后会写回脚本里对应的那一行。支持 `$LaTeX$`、Ctrl+Enter 换行。标题栏可拖动。'
                        : '在右键处插入一段文字。支持 `$LaTeX$`（例如 `面积 $S=\\pi r^2$`）、Ctrl+Enter 换行。标题栏可拖动。'}
                </Hint>

                <Body>
                    <Column>
                        <FieldLabel htmlFor="textCreateInput">文字内容</FieldLabel>
                        <TextArea
                            id="textCreateInput"
                            ref={textareaRef}
                            value={spec.content}
                            spellCheck={false}
                            placeholder={'例如：\n三角形 ABC\n面积 $S=\\frac{1}{2}ah$'}
                            onChange={event => update('content', event.target.value)}
                        />

                        <FieldRow>
                            <FieldLabel htmlFor="textCreateFamily">字体</FieldLabel>
                            <Select
                                id="textCreateFamily"
                                value={spec.fontFamily}
                                onChange={event => update('fontFamily', event.target.value)}
                            >
                                {FONT_FAMILIES.map(font => (
                                    <option key={font.value} value={font.value}>{font.label}</option>
                                ))}
                            </Select>
                        </FieldRow>

                        <FieldRow>
                            <FieldLabel htmlFor="textCreateSize">字号</FieldLabel>
                            <NumberInput
                                id="textCreateSize"
                                type="number"
                                min={8}
                                max={120}
                                step={1}
                                value={spec.fontSize}
                                onChange={event => update('fontSize', Number(event.target.value))}
                            />
                            <Unit>px</Unit>
                            <Toggle
                                type="button"
                                $active={spec.bold}
                                title="粗体"
                                onClick={() => update('bold', !spec.bold)}
                            >
                                <strong>B</strong>
                            </Toggle>
                            <Toggle
                                type="button"
                                $active={spec.italic}
                                title="斜体"
                                onClick={() => update('italic', !spec.italic)}
                            >
                                <em>I</em>
                            </Toggle>
                        </FieldRow>

                        <FieldRow>
                            <FieldLabel htmlFor="textCreateColor">颜色</FieldLabel>
                            <ColorInput
                                id="textCreateColor"
                                type="color"
                                value={spec.color}
                                onChange={event => update('color', event.target.value)}
                            />
                            <Swatches>
                                {COLOR_PRESETS.map(preset => (
                                    <Swatch
                                        key={preset.value}
                                        type="button"
                                        $color={preset.value}
                                        title={preset.label}
                                        onClick={() => update('color', preset.value)}
                                    />
                                ))}
                            </Swatches>
                        </FieldRow>

                        <FieldRow>
                            <FieldLabel htmlFor="textCreateBg">背景</FieldLabel>
                            <ColorInput
                                id="textCreateBg"
                                type="color"
                                value={spec.backgroundColor || '#ffffff'}
                                onChange={event => update('backgroundColor', event.target.value)}
                            />
                            <CheckboxLabel>
                                <input
                                    type="checkbox"
                                    checked={spec.backgroundColor !== ''}
                                    onChange={event => update('backgroundColor', event.target.checked ? '#fff3bf' : '')}
                                />
                                加底色
                            </CheckboxLabel>
                            <NumberInput
                                type="number"
                                min={0}
                                max={40}
                                step={1}
                                value={spec.padding}
                                disabled={!spec.backgroundColor}
                                title="背景内边距（像素）"
                                onChange={event => update('padding', Number(event.target.value))}
                            />
                            <Unit>px 边距</Unit>
                        </FieldRow>
                    </Column>

                    <Column>
                        <FieldLabel>预览</FieldLabel>
                        <PreviewBox>
                            <PreviewText style={previewStyle}>
                                {isEmpty
                                    ? <Muted>（在上面的输入框里打字）</Muted>
                                    : <LatexPreview text={spec.content} />}
                            </PreviewText>
                        </PreviewBox>
                        <MetaRow>
                            <span>位置 ({anchor.x.toFixed(2)}, {anchor.y.toFixed(2)})</span>
                            <span>Ctrl+Enter 确定</span>
                        </MetaRow>
                    </Column>
                </Body>

                <PreviewLabel>{isEdit ? '这一行文字将变成' : '将插入的指令'}</PreviewLabel>
                <CodePreview>
                    {command || '（内容为空，不会插入）'}
                </CodePreview>

                <Footer>
                    <GhostButton type="button" onClick={onCancel}>取消</GhostButton>
                    <PrimaryButton
                        type="button"
                        disabled={!canSubmit}
                        onClick={() => onSubmit(spec)}
                    >
                        {isEdit ? '保存' : '插入'}
                    </PrimaryButton>
                </Footer>
            </WidePanel>
        </Backdrop>,
        document.body,
    );
};

const WidePanel = styled(DraggablePanel)`
  width: min(760px, 100%);
`;

const Body = styled.div`
  display: flex;
  gap: 16px;
  align-items: stretch;

  /* 窄屏时左右改成上下，不然两个输入区都被挤成一条缝。 */
  @media (max-width: 680px) {
    flex-direction: column;
  }
`;

const Column = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FieldLabel = styled.label`
  flex-shrink: 0;
  min-width: 34px;
  color: #475569;
  font-size: 0.8rem;
`;

const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 96px;
  padding: 8px 10px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  color: #1f2937;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  font-size: 0.84rem;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }
`;

const Select = styled.select`
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-size: 0.82rem;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }
`;

const NumberInput = styled.input`
  width: 72px;
  padding: 6px 8px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  color: #1f2937;
  font-size: 0.82rem;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }

  &:disabled {
    background: #f1f5f9;
    color: #94a3b8;
  }
`;

const Unit = styled.span`
  color: #94a3b8;
  font-size: 0.74rem;
`;

const Toggle = styled.button<{ $active: boolean }>`
  width: 30px;
  height: 28px;
  padding: 0;
  border: 1px solid ${props => (props.$active ? '#2563eb' : '#d7dce5')};
  border-radius: 6px;
  background: ${props => (props.$active ? '#eff6ff' : '#ffffff')};
  color: ${props => (props.$active ? '#2563eb' : '#475569')};
  font-size: 0.82rem;
  cursor: pointer;

  &:hover {
    border-color: #2563eb;
  }
`;

const ColorInput = styled.input`
  width: 34px;
  height: 28px;
  padding: 2px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
`;

const Swatches = styled.div`
  display: flex;
  gap: 4px;
`;

const Swatch = styled.button<{ $color: string }>`
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 4px;
  background: ${props => props.$color};
  cursor: pointer;

  &:hover {
    transform: scale(1.12);
  }
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 4px;
  color: #475569;
  font-size: 0.78rem;
  cursor: pointer;
`;

const PreviewBox = styled.div`
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  /* 方格底纹：透明背景/无底色时也能看出文字边界，白底才不会有「预览一片空白」的错觉。 */
  background-color: #ffffff;
  background-image:
    linear-gradient(45deg, #f1f5f9 25%, transparent 25%),
    linear-gradient(-45deg, #f1f5f9 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f1f5f9 75%),
    linear-gradient(-45deg, transparent 75%, #f1f5f9 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  overflow: auto;
  box-sizing: border-box;
`;

const PreviewText = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  text-align: center;
`;

const Muted = styled.span`
  color: #cbd5e1;
  font-size: 0.8rem;
`;

const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #94a3b8;
  font-size: 0.72rem;
`;

export default TextCreateDialog;
