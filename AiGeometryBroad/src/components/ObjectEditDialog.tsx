import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import type { VariableInfo } from '../core/DSLInterpreter';
import ObjectPropertyEditor, { type ObjectPropertyEditorHandlers } from './ObjectPropertyEditor';
import {
    Backdrop,
    DraggablePanel,
    DragHandle,
    Header,
    Title,
    CloseButton,
    Hint,
    Footer,
    PrimaryButton,
    useDragOffset,
} from './DialogChrome';

export interface ObjectEditDialogProps {
    /** 要编辑的对象（解释器渲染完吐出来的那份快照）。 */
    object: VariableInfo;
    /**
     * 主画布元素。直接 drawImage 过来当左边的图形预览 ——
     * 不重跑脚本，所以随机点不会跳位置、动画不会重启、KaTeX 也不会重排。
     */
    sourceCanvas: HTMLCanvasElement | null;
    canvasWidth: number;
    canvasHeight: number;
    handlers: ObjectPropertyEditorHandlers;
    /** 冻结 / 解冻一个点（写回 `CREATE POINT ... frozen=`）。 */
    onTogglePointFrozen: (name: string, frozen: boolean, lineNumber?: number) => void;
    /** 冻结 / 解冻一个随机对象（冻结它当前的坐标）。 */
    onToggleRandomObject: (name: string, frozen: boolean) => void;
    onClose: () => void;
}

/**
 * 「编辑对象」对话框 —— 右键一个对象 → 编辑对象… 打开。
 *
 * 左边是**当前图形**，右边是属性，改动立即生效也立即反映到左边。
 *
 * 几个设计决定：
 *   1. **改动立即生效**，所以底下只有一个「关闭」按钮，没有确定 / 取消。
 *      和面板里点一下就走的行为一致；也避免了「对话框里的暂存值」和
 *      「脚本里已生效的值」两份状态对不上。
 *   2. 左边的图形是主画布的**像素副本**，跟着对象快照一起刷新（每次属性改动都会重跑脚本
 *      → 画布重绘 → 变量快照换新 → 这里重贴一次）。所以不需要额外的「刷新」按钮。
 *   3. 遮罩很淡（`$faint`）：改动立刻生效，用户要能看见画布。遮罩仍然挡住指针事件。
 *   4. 可拖动。默认位置在屏幕中央，想看得更清楚就挪开。
 */
const ObjectEditDialog: React.FC<ObjectEditDialogProps> = ({
    object,
    sourceCanvas,
    canvasWidth,
    canvasHeight,
    handlers,
    onTogglePointFrozen,
    onToggleRandomObject,
    onClose,
}) => {
    const { offset, dragHandleProps } = useDragOffset();
    const figureRef = useRef<HTMLCanvasElement>(null);

    // 左边图形的刷新时机：`object` 每次重跑脚本都是新对象，所以它一变就重贴一次 ——
    // 这正是「改完属性左边立刻更新」的实现。
    //
    // 依赖里的 `object` 不能省：主画布元素的引用是不变的，光看它不会重贴。
    useEffect(() => {
        const canvas = figureRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 主画布可能因为容器尺寸变化而重建，尺寸不一致时按左上角对齐贴上去，不做缩放 ——
        // 两边的 width/height 属性本来就取自同一个容器尺寸。
        if (sourceCanvas) ctx.drawImage(sourceCanvas, 0, 0);
    }, [sourceCanvas, canvasWidth, canvasHeight, object]);

    // 冻结开关：随机对象冻的是「当前坐标」，普通点冻的是「它在画布上能不能拖」，
    // 两套机制不同，同一个对象上只会出现其中一个。
    //
    // 派生部件（多边形的顶点 / 边）不给开关：顶点别名指向的是用户那个点本体
    // （要冻去冻它），合成顶点在脚本里没有 `frozen` 可写 —— 给了就是个死按钮。
    const isDerivedPart = Boolean(object.partRole);
    const freeze = isDerivedPart
        ? null
        : object.randomObject
            ? {
                frozen: Boolean(object.frozen),
                label: '冻结坐标',
                title: '冻结后这个随机对象不再重新掷点，坐标固定为当前值',
                onToggle: (next: boolean) => onToggleRandomObject(object.name, next),
            }
            : object.objectType === 'point'
                ? {
                    frozen: Boolean(object.pointFrozen),
                    label: '冻结位置',
                    title: '冻结后该点在画布上无法拖动（写回 CREATE POINT 的 frozen 属性）',
                    onToggle: (next: boolean) => onTogglePointFrozen(object.name, next, object.lineNumber),
                }
                : null;

    return createPortal(
        <Backdrop $faint onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <WidePanel
                role="dialog"
                aria-modal="true"
                aria-label={`编辑对象 ${object.name}`}
                style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
            >
                <DragHandle {...dragHandleProps}>
                    <Header>
                        <Title>编辑对象 · {object.name}</Title>
                        <CloseButton type="button" onClick={onClose} aria-label="关闭">×</CloseButton>
                    </Header>
                </DragHandle>

                <Hint>
                    左边是当前图形，右边是它的属性。改动会立即生效，也立即反映到左边和画布上。
                </Hint>

                <Body>
                    <FigurePane>
                        <FigureCanvas ref={figureRef} width={canvasWidth} height={canvasHeight} />
                    </FigurePane>

                    <PropertyPane>
                        <ObjectPropertyEditor
                            object={object}
                            handlers={handlers}
                            variant="light"
                            showTitle={false}
                        />
                        {freeze && (
                            <FreezeRow>
                                <FreezeButton
                                    type="button"
                                    $frozen={freeze.frozen}
                                    title={freeze.title}
                                    onClick={() => freeze.onToggle(!freeze.frozen)}
                                >
                                    {freeze.frozen ? `解冻（${freeze.label}）` : freeze.label}
                                </FreezeButton>
                                <FreezeState>{freeze.frozen ? '已冻结' : '未冻结'}</FreezeState>
                            </FreezeRow>
                        )}
                    </PropertyPane>
                </Body>

                <Footer>
                    <PrimaryButton type="button" onClick={onClose}>关闭</PrimaryButton>
                </Footer>
            </WidePanel>
        </Backdrop>,
        document.body,
    );
};

// 两列要放得下，所以比默认的面板宽一些。
const WidePanel = styled(DraggablePanel)`
  width: min(1040px, 100%);
`;

/**
 * 左图右属性。窄屏（或对话框被拖到屏幕边上）时自动折成一列 ——
 * `flex-wrap` 让两栏各自有最小宽度，放不下就换行，不会把图形挤成一条缝。
 */
const Body = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
  min-height: 0;
`;

const FigurePane = styled.div`
  flex: 1 1 320px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const FigureCanvas = styled.canvas`
  display: block;
  max-width: 100%;
  max-height: 52vh;
  /* 画布按属性像素绘制，缩放到视口时保持比例，避免和右边说的坐标对不上 */
  object-fit: contain;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
`;

/** 属性栏。比原来「整行铺满」窄得多，但内容一行不少；放不下时自己滚。 */
const PropertyPane = styled.div`
  flex: 1 1 300px;
  min-width: 240px;
  max-height: 52vh;
  overflow: auto;
`;

const FreezeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
`;

const FreezeButton = styled.button<{ $frozen: boolean }>`
  padding: 6px 14px;
  border: 1px solid ${({ $frozen }) => ($frozen ? '#f59e0b' : '#d7dce5')};
  border-radius: 6px;
  background: ${({ $frozen }) => ($frozen ? 'rgba(245, 158, 11, 0.12)' : '#ffffff')};
  color: ${({ $frozen }) => ($frozen ? '#b45309' : '#475569')};
  font-size: 0.8rem;
  cursor: pointer;

  &:hover {
    border-color: ${({ $frozen }) => ($frozen ? '#d97706' : '#2563eb')};
    color: ${({ $frozen }) => ($frozen ? '#92400e' : '#1d4ed8')};
  }
`;

const FreezeState = styled.span`
  color: #94a3b8;
  font-size: 0.74rem;
`;

export default ObjectEditDialog;
