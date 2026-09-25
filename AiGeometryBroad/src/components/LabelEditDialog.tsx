import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import { updateDslObjectLabel } from '../core/dslPropertySync';
import {
    Backdrop,
    Panel,
    Header,
    Title,
    CloseButton,
    Hint,
    Footer,
    GhostButton,
    PrimaryButton,
    PreviewLabel,
    CodePreview,
} from './DialogChrome';

export interface LabelEditDialogProps {
    /** 被改标签的对象名。 */
    objectName: string;
    /** 对象类型，只用来显示标题。 */
    objectType: string;
    /** 当前标签（空串表示还没设过）。 */
    initialValue: string;
    /** 标签会写到哪一行，用于代码预览。 */
    lineNumber: number;
    /** 整个脚本，用来算「改完这一行长什么样」。 */
    script: string;
    /** false 表示这个对象当前没有可挂标签的指令，输入框只读。 */
    editable: boolean;
    /** 不可编辑时说明原因。 */
    reason?: string;
    onCancel: () => void;
    onSubmit: (value: string) => void;
}

/**
 * 修改对象标签的对话框。
 *
 * 复用 `GeometryPickDialog` 的外壳样式（见 DialogChrome），所以两个右键对话框
 * 看起来是同一个东西，而不是两个各自长大的弹窗。
 *
 * 预览用的是**真正写回脚本的那个函数**（`updateDslObjectLabel`），
 * 不是另写一段拼接 —— 否则「预览的样子」和「落地的结果」迟早会分叉。
 */
const LabelEditDialog: React.FC<LabelEditDialogProps> = ({
    objectName,
    objectType,
    initialValue,
    lineNumber,
    script,
    editable,
    reason,
    onCancel,
    onSubmit,
}) => {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    // 打开就聚焦并全选：绝大多数操作是「整条替换」或「直接清空重写」，
    // 让用户先按退格比让他先按 Ctrl+A 顺手。
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const trimmed = value.trim();
    const unchanged = trimmed === initialValue.trim();

    const preview = useMemo(() => {
        const update = updateDslObjectLabel(script, objectName, value, { lineNumber });
        if (!update) return null;
        return update.script.split('\n')[update.lineNumber - 1];
    }, [script, objectName, value, lineNumber]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (editable) onSubmit(value);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel, onSubmit, editable, value]);

    return createPortal(
        <Backdrop onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
            <NarrowPanel role="dialog" aria-modal="true" aria-label="修改标签">
                <Header>
                    <Title>修改标签 · {objectName}</Title>
                    <CloseButton type="button" onClick={onCancel} aria-label="关闭">×</CloseButton>
                </Header>

                <Hint>
                    {editable
                        ? '标签会写进脚本的 label=，并立刻重画。留空表示不显示标签。'
                        : reason}
                </Hint>

                <Field>
                    <FieldLabel htmlFor="labelEditInput">标签</FieldLabel>
                    <TextInput
                        id="labelEditInput"
                        ref={inputRef}
                        type="text"
                        value={value}
                        disabled={!editable}
                        placeholder="留空 = 不显示"
                        spellCheck={false}
                        onChange={event => setValue(event.target.value)}
                    />
                </Field>

                <MetaRow>
                    <span>{objectType} · 第 {lineNumber} 行</span>
                    <span>支持中文与 $LaTeX$</span>
                </MetaRow>

                <PreviewLabel>这一行将变成</PreviewLabel>
                <CodePreview>
                    {preview ?? '（这一行不参与标签，改动不会生效）'}
                </CodePreview>

                <Footer>
                    <GhostButton
                        type="button"
                        disabled={!editable || trimmed === ''}
                        onClick={() => onSubmit('')}
                    >
                        清除标签
                    </GhostButton>
                    <GhostButton type="button" onClick={onCancel}>取消</GhostButton>
                    <PrimaryButton
                        type="button"
                        disabled={!editable || unchanged}
                        onClick={() => onSubmit(value)}
                    >
                        确定
                    </PrimaryButton>
                </Footer>
            </NarrowPanel>
        </Backdrop>,
        document.body,
    );
};

const NarrowPanel = styled(Panel)`
  /* 只有一个输入框，不需要作图对话框那么宽。 */
  width: min(460px, 100%);
`;

const Field = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const FieldLabel = styled.label`
  flex-shrink: 0;
  color: #475569;
  font-size: 0.82rem;
`;

const TextInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  color: #1f2937;
  font-size: 0.85rem;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }

  &:disabled {
    background: #f1f5f9;
    color: #94a3b8;
  }
`;

const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: #94a3b8;
  font-size: 0.74rem;
`;

export default LabelEditDialog;
