import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import {
    describePickOperation,
    validatePick,
    type OptionValues,
    type PickOperation,
    type PickOptionField,
} from '../core/geometryCommandBuilder';
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

// 主体对象、候选目标、hover 三种标记色。
// 候选目标沿用画布上的选中色（DSLInterpreter 的 SELECTED_OBJECT_COLOR），
// 让「在对话框里选中的东西」和「在画布上选中的东西」看起来是同一件事。
const ANCHOR_COLOR = '#2563eb';
const TARGET_COLOR = '#e11d48';
const HOVER_COLOR = '#f59e0b';

export interface HitTestResult {
    name: string;
    type: string;
}

export interface GeometryPickDialogProps {
    /** 作图主体：右键命中的那个对象。 */
    anchorName: string;
    /** 主体的类型（point / line / segment / ray）。 */
    anchorType: string;
    kind: PickOperation;
    /** 用户在图形里点选的目标；不需要点选或还没点选时为 null。 */
    targetName: string | null;
    /** 参数值，由描述符的 defaults 初始化。 */
    options: OptionValues;
    /**
     * 主画布元素。对话框直接把它 drawImage 过来当底图，
     * 这样「复制当前显示界面」是像素级的复制：不重新执行脚本，
     * 随机点不会跳位置，动画不会被重启，KaTeX 也不会重排。
     */
    sourceCanvas: HTMLCanvasElement | null;
    canvasWidth: number;
    canvasHeight: number;
    /** 将要插入的代码；条件不满足时为空数组。 */
    commands: string[];
    onPick: (name: string | null) => void;
    onOptionChange: (key: string, value: string | number | boolean) => void;
    /** 命中测试，入参是画布像素坐标（与主画布同一套坐标）。 */
    hitTest: (canvasX: number, canvasY: number) => HitTestResult | null;
    /** 在副本上高亮某个对象。 */
    drawHighlight: (ctx: CanvasRenderingContext2D, name: string, color: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

const GeometryPickDialog: React.FC<GeometryPickDialogProps> = ({
    anchorName,
    anchorType,
    kind,
    targetName,
    options,
    sourceCanvas,
    canvasWidth,
    canvasHeight,
    commands,
    onPick,
    onOptionChange,
    hitTest,
    drawHighlight,
    onCancel,
    onConfirm,
}) => {
    const baseCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const [hoverName, setHoverName] = useState<string | null>(null);
    const [pickError, setPickError] = useState<string | null>(null);

    const descriptor = useMemo(
        () => describePickOperation(kind, anchorName, anchorType),
        [kind, anchorName, anchorType],
    );
    const pick = descriptor.pick;

    const isCandidate = useCallback((hit: HitTestResult | null): boolean => {
        if (!pick) return false;
        return validatePick(pick, hit, anchorName).ok;
    }, [pick, anchorName]);

    // 底图：只在画布来源或尺寸变化时重画一次。
    useEffect(() => {
        const canvas = baseCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 主画布可能因为容器尺寸变化而重建，尺寸不一致时按左上角对齐贴上去，
        // 不做缩放——两边的 width/height 属性本来就取自同一个容器尺寸。
        if (sourceCanvas) ctx.drawImage(sourceCanvas, 0, 0);
    }, [sourceCanvas, canvasWidth, canvasHeight]);

    // 高亮层：hover 或已选目标变化时重画。放在独立画布上，
    // 这样移动鼠标不会反复重绘底图（drawImage 一张整屏位图并不便宜）。
    useEffect(() => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawHighlight(ctx, anchorName, ANCHOR_COLOR);
        if (targetName) {
            drawHighlight(ctx, targetName, TARGET_COLOR);
        } else if (hoverName) {
            drawHighlight(ctx, hoverName, HOVER_COLOR);
        }
    }, [anchorName, targetName, hoverName, drawHighlight]);

    const toCanvasPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        // 画布属性尺寸与 CSS 尺寸可能不同（对话框里按视口收缩过），统一换算到画布像素，
        // 和主画布的命中检测保持同一套坐标。
        const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
        const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    };

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!pick) return;
        const point = toCanvasPoint(event);
        const hit = hitTest(point.x, point.y);
        const validation = validatePick(pick, hit, anchorName);
        if (!validation.ok || !hit) {
            setPickError(validation.message ?? null);
            return;
        }
        setPickError(null);
        // 再点一次已选中的目标就取消选择，方便改主意。
        onPick(hit.name === targetName ? null : hit.name);
    };

    const handleMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!pick) return;
        const point = toCanvasPoint(event);
        const hit = hitTest(point.x, point.y);
        const next = isCandidate(hit) ? hit!.name : null;
        // 值没变时不要触发重渲染，否则每次 mousemove 都会重画一遍高亮层。
        setHoverName(previous => (previous === next ? previous : next));
    };

    // Esc 取消、Enter 确定。对话框是模态的，键盘操作比找按钮快。
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            } else if (event.key === 'Enter' && commands.length > 0) {
                event.preventDefault();
                onConfirm();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel, onConfirm, commands.length]);

    const renderField = (field: PickOptionField) => {
        if (field.visibleWhen && !field.visibleWhen(options)) return null;

        if (field.kind === 'number') {
            return (
                <OptionRow key={field.key}>
                    <OptionLabelText>{field.label}</OptionLabelText>
                    <NumberInput
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={String(options[field.key] ?? '')}
                        onChange={event => {
                            const raw = event.target.value;
                            if (raw === '') {
                                // 留空先存空串：生成代码时 optionNumber 会退回默认值，
                                // 不会把 0 当成用户填的数。
                                onOptionChange(field.key, '');
                                return;
                            }
                            const parsed = Number(raw);
                            if (!Number.isFinite(parsed)) return;
                            onOptionChange(field.key, field.integer ? Math.round(parsed) : parsed);
                        }}
                    />
                </OptionRow>
            );
        }

        if (field.kind === 'select') {
            return (
                <OptionRow key={field.key}>
                    <OptionLabelText>{field.label}</OptionLabelText>
                    <SelectInput
                        value={String(options[field.key] ?? '')}
                        onChange={event => onOptionChange(field.key, event.target.value)}
                    >
                        {field.options.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </SelectInput>
                </OptionRow>
            );
        }

        return (
            <OptionRow key={field.key}>
                <CheckboxLabel>
                    <input
                        type="checkbox"
                        checked={options[field.key] === true}
                        onChange={event => onOptionChange(field.key, event.target.checked)}
                    />
                    <span>{field.label}</span>
                </CheckboxLabel>
            </OptionRow>
        );
    };

    const visibleFields = descriptor.fields.filter(
        field => !field.visibleWhen || field.visibleWhen(options),
    );

    return createPortal(
        <Backdrop onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
            <Panel role="dialog" aria-modal="true" aria-label={descriptor.title}>
                <Header>
                    <Title>{descriptor.title}</Title>
                    <CloseButton type="button" onClick={onCancel} aria-label="关闭">×</CloseButton>
                </Header>

                <Hint>{descriptor.hint}</Hint>

                <CanvasFrame>
                    <BaseCanvas ref={baseCanvasRef} width={canvasWidth} height={canvasHeight} />
                    <OverlayCanvas
                        ref={overlayCanvasRef}
                        width={canvasWidth}
                        height={canvasHeight}
                        $pickable={pick !== null}
                        onClick={handleClick}
                        onMouseMove={handleMove}
                        onMouseLeave={() => setHoverName(null)}
                    />
                </CanvasFrame>

                <StatusRow>
                    <StatusAnchor>作图主体：<strong>{anchorName}</strong></StatusAnchor>
                    {pick && (
                        targetName
                            ? <StatusOk>已选择{pick === 'point' ? '点' : '直线'}：<strong>{targetName}</strong></StatusOk>
                            : <StatusPending>尚未选择{pick === 'point' ? '点' : '直线'}</StatusPending>
                    )}
                    {pickError && <StatusError>{pickError}</StatusError>}
                </StatusRow>

                {visibleFields.length > 0 && <OptionsBlock>{visibleFields.map(renderField)}</OptionsBlock>}

                <PreviewLabel>将插入的代码</PreviewLabel>
                <CodePreview>
                    {commands.length > 0
                        ? commands.join('\n')
                        : pick && !targetName
                            ? '（在上方图形中点击目标后生成）'
                            : '（当前条件无法生成代码，请检查参数）'}
                </CodePreview>

                <Footer>
                    <GhostButton type="button" onClick={onCancel}>取消</GhostButton>
                    <PrimaryButton type="button" disabled={commands.length === 0} onClick={onConfirm}>
                        确定
                    </PrimaryButton>
                </Footer>
            </Panel>
        </Backdrop>,
        document.body,
    );
};

const CanvasFrame = styled.div`
  position: relative;
  align-self: center;
  max-width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
`;

// 底图。max-* 只写在这里，不能写成 `CanvasFrame canvas { ... }`：
// 后代选择器（0,1,1）的特异性高于单类（0,1,0），会把覆盖层上的
// `width/height: 100%` 一起收缩掉，高亮就和底图错位了。
const BaseCanvas = styled.canvas`
  display: block;
  max-width: 100%;
  max-height: 46vh;
  /* 画布按属性像素绘制，缩放到视口时保持比例，避免命中坐标和视觉错位 */
  object-fit: contain;
`;

interface OverlayCanvasProps {
    $pickable: boolean;
}

const OverlayCanvas = styled.canvas<OverlayCanvasProps>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 不需要点选目标的操作（在线上取点、等分、延长、中垂线）里，这层只负责显示高亮。 */
  cursor: ${({ $pickable }) => ($pickable ? 'crosshair' : 'default')};
`;

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  min-height: 20px;
  font-size: 0.8rem;
`;

const StatusAnchor = styled.span`
  color: #475569;
`;

const StatusOk = styled.span`
  color: #15803d;
`;

const StatusPending = styled.span`
  color: #94a3b8;
`;

const StatusError = styled.span`
  color: #dc2626;
`;

const OptionsBlock = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  margin-top: 10px;
`;

const OptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const OptionLabelText = styled.span`
  color: #475569;
  font-size: 0.8rem;
`;

const CheckboxLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 0.8rem;
  cursor: pointer;
`;

const NumberInput = styled.input`
  width: 92px;
  padding: 5px 8px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  color: #1f2937;
  font-size: 0.8rem;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }
`;

const SelectInput = styled.select`
  padding: 5px 8px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-size: 0.8rem;

  &:focus {
    outline: none;
    border-color: #2563eb;
  }
`;

export default GeometryPickDialog;
