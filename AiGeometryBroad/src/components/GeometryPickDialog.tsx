import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import {
    describePickOperation,
    getPickProductKind,
    validatePick,
    type OptionValues,
    type PickDescriptorContext,
    type PickOperation,
    type PickOptionField,
    type PickStyleOptions,
    type Point2D,
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

/**
 * 颜色下拉里的预设。
 *
 * 只给预设、不给取色器：这一栏的语义是「要不要**覆盖**默认色」，
 * 而不是「调一个精确的颜色」—— 覆盖色的用途是「这条辅助线想画红一点」，
 * 不是做配色。真要精确颜色，生成的代码就在下面，手改一个 hex 更快。
 * 第一项固定是「默认」，选它等于不写 `color=`。
 */
const COLOR_PRESETS = [
    { value: '#1f2937', label: '黑' },
    { value: '#dc2626', label: '红' },
    { value: '#2563eb', label: '蓝' },
    { value: '#16a34a', label: '绿' },
    { value: '#9333ea', label: '紫' },
    { value: '#ea580c', label: '橙' },
    { value: '#94a3b8', label: '灰' },
];

/** 没传 `descriptorContext` 时的兜底值。放在模块级是为了保持引用稳定。 */
const EMPTY_CONTEXT: PickDescriptorContext = {};

/** 没传 `style` 时的兜底值，同上。 */
const EMPTY_STYLE: PickStyleOptions = {};

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
    /** 样式覆盖；没填的项不会出现在生成的指令里。 */
    style?: PickStyleOptions;
    /**
     * 描述对话框要用的画布现状（端点名、已创建的角…）。
     * 由打开对话框的一侧取快照传入，画布与这里必须拿到同一份，否则默认值对不上。
     */
    descriptorContext?: PickDescriptorContext;
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
    onStyleChange: (key: keyof PickStyleOptions, value: string | number) => void;
    /** 命中测试，入参是画布像素坐标（与主画布同一套坐标）。 */
    hitTest: (canvasX: number, canvasY: number) => HitTestResult | null;
    /**
     * 画布像素坐标 → 逻辑坐标。用来把「在图形上拖动」的位置换算成作图用的落点。
     */
    toLogicalPoint?: (canvasX: number, canvasY: number) => Point2D | null;
    /**
     * 拖动调整「落点」（在线上取点用的就是它）。
     *
     * 传了它、并且这个作图不需要点选目标（`pick === null`）时，图形上的按住拖动
     * 就变成移动那个点；否则拖动不改变任何东西。两个条件缺一不可 ——
     * 需要点选的作图里，拖动会被误当成「想平移视图」。
     */
    onAnchorPointChange?: (point: Point2D) => void;
    /** 在副本上高亮某个对象。 */
    drawHighlight: (ctx: CanvasRenderingContext2D, name: string, color: string) => void;
    /**
     * 把将要插入的指令画到预览层上，让用户**立刻**看到作图结果。
     * 由画布侧实现（解释器有全部对象），对话框只负责在合适的时机调它。
     */
    renderPreview: (ctx: CanvasRenderingContext2D, commands: string[]) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

const GeometryPickDialog: React.FC<GeometryPickDialogProps> = ({
    anchorName,
    anchorType,
    kind,
    targetName,
    options,
    style,
    descriptorContext,
    sourceCanvas,
    canvasWidth,
    canvasHeight,
    commands,
    onPick,
    onOptionChange,
    onStyleChange,
    hitTest,
    toLogicalPoint,
    onAnchorPointChange,
    drawHighlight,
    renderPreview,
    onCancel,
    onConfirm,
}) => {
    const baseCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const [hoverName, setHoverName] = useState<string | null>(null);
    const [pickError, setPickError] = useState<string | null>(null);

    // 空对象常量放模块级，避免「没传 context / style」时每次渲染都造一个新对象、
    // 把下面的 useMemo 打回每次重算。
    const descriptor = useMemo(
        () => describePickOperation(kind, anchorName, anchorType, descriptorContext ?? EMPTY_CONTEXT),
        [kind, anchorName, anchorType, descriptorContext],
    );
    const pick = descriptor.pick;
    const styleValues = style ?? EMPTY_STYLE;
    // 截止点只对线性对象成立 —— 给一个点填 `cutPoints=` 是无效参数，
    // 与其显示一个不起作用的输入框，不如根本不显示。
    const showCutPoints = getPickProductKind(kind) === 'linear';

    const isCandidate = useCallback((hit: HitTestResult | null): boolean => {
        if (!pick) return false;
        return validatePick(pick, hit, anchorName).ok;
    }, [pick, anchorName]);

    const visibleFields = useMemo(
        () => descriptor.fields.filter(field => !field.visibleWhen || field.visibleWhen(options)),
        [descriptor, options],
    );
    /**
     * 「候选是画布上的对象」的那个字段（目前是「延长」的参照线段）。
     *
     * 它的候选项名字形如 `seg_3` / `tri_2_e1`，光看下拉框根本认不出是哪条线，
     * 所以它额外支持**在图形上直接点选**，而且选中的那条会在图上画成红色。
     */
    const referenceField = visibleFields.find(
        (field): field is Extract<PickOptionField, { kind: 'select' }> =>
            field.kind === 'select' && field.canvasPick === true,
    );
    const referenceCandidates = useMemo(
        () => (referenceField ? new Set(referenceField.options.map(option => option.value)) : null),
        [referenceField],
    );
    const referenceName = referenceField ? String(options[referenceField.key] ?? '') : '';

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

    // 预览层：把「将要插入的指令」画出来 —— 用户改一个参数就重画一次。
    // 夹在底图和高亮层之间：底图是既有图形，高亮是「已选中的目标」，
    // 两者都不该被预览盖住，而预览又要能盖在既有图形上看清新东西画在哪。
    useEffect(() => {
        const canvas = previewCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (commands.length === 0) return;
        renderPreview(ctx, commands);
    }, [commands, renderPreview, canvasWidth, canvasHeight]);

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
        // 参照对象（「延长」的参照线段）：**选中的画红**、鼠标压上去的画琥珀。
        // 放在锚点之后 —— 它比锚点更「当前」，被两者同时命中时应该看到它。
        if (referenceName) {
            drawHighlight(ctx, referenceName, TARGET_COLOR);
        } else if (hoverName) {
            drawHighlight(ctx, hoverName, HOVER_COLOR);
        }
    }, [anchorName, targetName, hoverName, referenceName, drawHighlight]);

    /**
     * 能不能在图形上拖动「落点」。
     *
     * 两个条件缺一不可：作图得真的用得到落点（传了 `onAnchorPointChange` + `toLogicalPoint`），
     * 而且它不要求点选目标（`pick === null`）—— 需要点选的作图里，按住拖动会被误当成
     * 「想平移视图」，和点选冲突。
     */
    const canDragAnchor = Boolean(onAnchorPointChange && toLogicalPoint)
        && descriptor.usesAnchorPoint === true;

    /** 客户端坐标 → 画布像素坐标（和主画布的命中检测同一套坐标）。 */
    const toCanvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        // 画布属性尺寸与 CSS 尺寸可能不同（对话框里按视口收缩过），统一换算到画布像素。
        const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
        const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    };

    /** 把一次鼠标位置写成新的落点。换算不出逻辑坐标（画布还没就绪）就什么都不做。 */
    const applyAnchorAt = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
        if (!onAnchorPointChange || !toLogicalPoint) return;
        const point = toCanvasPoint(canvas, clientX, clientY);
        const logical = toLogicalPoint(point.x, point.y);
        if (logical) onAnchorPointChange(logical);
    };

    const handleAnchorMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canDragAnchor) return;
        event.preventDefault();
        const canvas = event.currentTarget;
        applyAnchorAt(canvas, event.clientX, event.clientY);
        // 监听挂在 window 上：手滑出图形边界（甚至滑到对话框外面）时拖动不能断，
        // 只挂在 canvas 上的话一出界就停住了。
        const handleMove = (moveEvent: MouseEvent) => applyAnchorAt(canvas, moveEvent.clientX, moveEvent.clientY);
        const handleUp = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
    };

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);

        if (pick) {
            const hit = hitTest(point.x, point.y);
            const validation = validatePick(pick, hit, anchorName);
            if (!validation.ok || !hit) {
                setPickError(validation.message ?? null);
                return;
            }
            setPickError(null);
            // 再点一次已选中的目标就取消选择，方便改主意。
            onPick(hit.name === targetName ? null : hit.name);
            return;
        }

        // 参照对象字段：点到的对象在候选名单里就选它（不用去下拉框里翻）。
        if (!referenceField || !referenceCandidates) return;
        const hit = hitTest(point.x, point.y);
        if (hit && referenceCandidates.has(hit.name)) {
            onOptionChange(referenceField.key, hit.name);
        }
    };

    const handleMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        // 两种「在图上选东西」共用同一个 hover 状态：点选目标、或参照对象。
        // 两边的候选名单来源不同，所以分开判。
        let next: string | null = null;
        if (pick || referenceCandidates) {
            const point = toCanvasPoint(event.currentTarget, event.clientX, event.clientY);
            const hit = hitTest(point.x, point.y);
            if (pick) next = isCandidate(hit) ? hit!.name : null;
            else if (hit && referenceCandidates!.has(hit.name)) next = hit.name;
        }
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
                    <PreviewCanvas ref={previewCanvasRef} width={canvasWidth} height={canvasHeight} />
                    <OverlayCanvas
                        ref={overlayCanvasRef}
                        width={canvasWidth}
                        height={canvasHeight}
                        $pickable={pick !== null || Boolean(referenceField)}
                        $draggable={canDragAnchor}
                        onClick={handleClick}
                        onMouseDown={handleAnchorMouseDown}
                        onMouseMove={handleMove}
                        onMouseLeave={() => setHoverName(null)}
                    />
                </CanvasFrame>

                {referenceField && (
                    <CanvasHint>
                        可以直接在图形上点选「{referenceField.label}」；选中的那条会画成红色
                    </CanvasHint>
                )}

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

                {/* 样式区。每一项的「默认」= 不写进代码 —— 生成的指令只带用户真的改过的那几个参数。 */}
                <SectionLabel>样式（保持「默认」的项不会写进代码）</SectionLabel>
                <OptionsBlock>
                    <OptionRow>
                        <OptionLabelText>颜色</OptionLabelText>
                        <SelectInput
                            value={styleValues.color ?? ''}
                            onChange={event => onStyleChange('color', event.target.value)}
                        >
                            <option value="">默认</option>
                            {COLOR_PRESETS.map(preset => (
                                <option key={preset.value} value={preset.value}>{preset.label}（{preset.value}）</option>
                            ))}
                        </SelectInput>
                    </OptionRow>
                    <OptionRow>
                        <OptionLabelText>线宽</OptionLabelText>
                        <NumberInput
                            type="number"
                            min={0.5}
                            max={20}
                            step={0.5}
                            placeholder="默认"
                            value={styleValues.lineWidth === undefined ? '' : String(styleValues.lineWidth)}
                            onChange={event => {
                                const raw = event.target.value;
                                // 留空 = 回到默认（把这一项从 style 里删掉），而不是写一个 0。
                                if (raw === '') {
                                    onStyleChange('lineWidth', '');
                                    return;
                                }
                                const parsed = Number(raw);
                                if (Number.isFinite(parsed) && parsed > 0) onStyleChange('lineWidth', parsed);
                            }}
                        />
                    </OptionRow>
                    <OptionRow>
                        <OptionLabelText>线型</OptionLabelText>
                        <SelectInput
                            value={styleValues.lineStyle ?? ''}
                            onChange={event => onStyleChange('lineStyle', event.target.value)}
                        >
                            <option value="">默认</option>
                            <option value="dashed">虚线</option>
                        </SelectInput>
                    </OptionRow>
                    <OptionRow>
                        <OptionLabelText>标签</OptionLabelText>
                        <TextInput
                            type="text"
                            placeholder="默认"
                            value={styleValues.label ?? ''}
                            onChange={event => onStyleChange('label', event.target.value)}
                        />
                    </OptionRow>
                    {showCutPoints && (
                        <OptionRow>
                            <OptionLabelText>截断点</OptionLabelText>
                            <TextInput
                                type="text"
                                placeholder="如 +A,-B"
                                value={styleValues.cutPoints ?? ''}
                                onChange={event => onStyleChange('cutPoints', event.target.value)}
                            />
                        </OptionRow>
                    )}
                </OptionsBlock>

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
    /** 可以在图形上按住拖动来移动落点（「在线上取点」）。 */
    $draggable?: boolean;
}

/**
 * 实时预览层。夹在底图和高亮层之间，且**不吃鼠标事件** ——
 * 它只是把「将要插入的指令」画出来，点选目标仍然由上面那层负责。
 */
const PreviewCanvas = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const OverlayCanvas = styled.canvas<OverlayCanvasProps>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 不需要点选目标的操作（在线上取点、等分、延长、中垂线）里，这层只负责显示高亮；
     「在线上取点」额外允许按住拖动来移动落点，所以光标同样是十字。 */
  cursor: ${({ $pickable, $draggable }) => ($pickable || $draggable ? 'crosshair' : 'default')};
`;

/** 图形下面那句「可以直接在图上点选…」。比正文小一号，不抢戏但看得见。 */
const CanvasHint = styled.div`
  margin-top: 8px;
  color: #64748b;
  font-size: 0.75rem;
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

/** 文本样式项（标签 / 截断点）的输入框。比 NumberInput 宽一点，够放一个中文标签。 */
const TextInput = styled.input`
  width: 150px;
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

/** 小节标题（「样式」）。和 PreviewLabel 同款，只是用在对话框中部。 */
const SectionLabel = styled.div`
  margin-top: 14px;
  color: #64748b;
  font-size: 0.74rem;
`;

export default GeometryPickDialog;
