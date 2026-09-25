import { GeometryDSLInterpreter } from './DSLInterpreter';
import { SvgRenderContext, type SvgBounds } from './SvgRenderContext';

export interface SvgExportViewState {
    // 视图中心的逻辑坐标
    centerX: number;
    centerY: number;
    // 缩放比例
    scale: number;
    // 画布平移量（屏幕像素）
    offsetX: number;
    offsetY: number;
    // 视图旋转角（弧度，绕画布中心）。导出要和画布上看到的一致，就必须带上它。
    rotation: number;
}

export interface SvgExportOptions {
    width: number;
    height: number;
    background?: string;
    view?: Partial<SvgExportViewState>;
    // 循环动画未声明 frames 时的默认采样帧数
    animationFrames?: number;
    onMessage?: (level: string, line: number, message: string) => void;
}

const DEFAULT_VIEW: SvgExportViewState = {
    centerX: 0,
    centerY: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 优先从动画表达式中的 slot % N 推断一个完整周期。
// 例如 slot_ani % 40 表示每 40 帧回到同一状态。
function inferAnimationFrames(script: string, slot: string): number | undefined {
    const slotPattern = escapeRegExp(slot);
    const forward = new RegExp(`${slotPattern}\\s*%\\s*(\\d+)`, 'i').exec(script);
    const backward = new RegExp(`(\\d+)\\s*%\\s*${slotPattern}`, 'i').exec(script);
    const value = parseInt(forward?.[1] || backward?.[1] || '', 10);
    return Number.isFinite(value) && value > 1 ? value : undefined;
}

function unionBounds(a: SvgBounds | null, b: SvgBounds | null): SvgBounds | null {
    if (!a) return b ? { ...b } : null;
    if (!b) return { ...a };
    return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
    };
}

// 将 DSL 脚本渲染为 SVG 源码
export function exportScriptToSvg(script: string, options: SvgExportOptions): string {
    // 默认不额外铺背景：脚本中的 CLEAR 命令本身会绘制背景矩形，
    // 再叠一层会覆盖它并让输出出现重复矩形。
    const { width, height, background = 'transparent' } = options;
    const view: SvgExportViewState = { ...DEFAULT_VIEW, ...(options.view || {}) };

    const context = new SvgRenderContext(width, height);

    // 虚拟 canvas：仅需提供绘制代码用到的 width / height / getContext
    const createVirtualCanvas = (target: SvgRenderContext) => ({
        width,
        height,
        getContext: (type: string) => (type === '2d' ? target : null),
    } as unknown as HTMLCanvasElement);

    const virtualCanvas = createVirtualCanvas(context);

    const interpreter = new GeometryDSLInterpreter(virtualCanvas, options.onMessage);
    // 离线导出不能启动 setTimeout，否则导出函数返回后仍会在后台修改状态
    interpreter.setAnimationAutoStart(false);

    // 视图变换：复用与画布一致的换算方式
    interpreter.setTransform(virtualCanvas, {
        x: view.offsetX,
        y: view.offsetY,
        scale: view.scale,
        rotation: view.rotation,
    });
    interpreter.setViewCenter(view.centerX, view.centerY);
    // SVG 渲染上下文没有预置视图变换，标签坐标需要由解释器自己完成换算
    interpreter.setContextPreTransformed(false);
    // 将当前画布的外层缩放/平移/旋转合并到所有几何对象和标签的坐标中，
    // 同时把默认直线/射线裁剪区域固定为整个 SVG 画布。
    interpreter.setRenderTransform({
        scale: view.scale,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
        rotation: view.rotation,
    });

    interpreter.execute(script);

    const animations = interpreter.getAnimationDefinitions();
    if (animations.length === 0) {
        return context.toSVG({ background });
    }

    // 一个 SVG 文件只能表达一个统一时间轴。多动画脚本按最短 interval 同步采样，
    // 每帧推进一次所有动画，保证导出的周期稳定且不会等待真实计时器。
    const primaryAnimation = animations[0];
    const defaultFrames = options.animationFrames && options.animationFrames > 0
        ? Math.floor(options.animationFrames)
        : 60;
    const inferredFrames = inferAnimationFrames(script, primaryAnimation.slot);
    const frameCount = Math.max(1, Math.floor(
        primaryAnimation.period || inferredFrames || (primaryAnimation.isRepeat ? defaultFrames : 1)
    ));
    // interval=0 表示「跟随显示器刷新率」，没有确定时长，导出时按 60fps 估算，
    // 否则 durationMs 会退化成 frameCount × 1ms，SVG 快到看不清。
    const frameInterval = Math.max(1000 / 60, primaryAnimation.interval);
    const frames: string[][] = [];
    let contentBounds = context.getBounds();

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const frameContext = new SvgRenderContext(width, height);
        const frameCanvas = createVirtualCanvas(frameContext);
        interpreter.setRenderTarget(frameCanvas, frameContext as unknown as CanvasRenderingContext2D);
        interpreter.setContextPreTransformed(false);

        for (const animation of animations) {
            // 有限动画只执行其第一帧；repeat 动画按采样周期逐帧推进。
            if (animation.isRepeat || frameIndex === 0) {
                interpreter.stepAnimation(animation.name);
            }
        }

        // 初始绘制内容由 SvgRenderContext 在动画组外统一输出；
        // 每个动画帧只保存本帧新增的绘制内容，避免重复复制坐标轴和曲线。 
        frames.push(frameContext.getElements());
        contentBounds = unionBounds(contentBounds, frameContext.getBounds());
    }

    return context.toSVG({
        background,
        contentBounds,
        animation: {
            frames,
            durationMs: frameCount * frameInterval,
        },
    });
}

// 触发浏览器下载
export function downloadSvg(svg: string, filename: string = 'geometry.svg'): void {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}

// 复制到剪贴板，返回是否成功
export async function copySvgToClipboard(svg: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(svg);
            return true;
        }
    } catch (error) {
        console.error('Failed to copy SVG via clipboard API:', error);
    }

    // 降级方案：使用隐藏 textarea + execCommand
    try {
        const textarea = document.createElement('textarea');
        textarea.value = svg;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (error) {
        console.error('Failed to copy SVG via fallback:', error);
        return false;
    }
}
