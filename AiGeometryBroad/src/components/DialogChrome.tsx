import React, { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';

/**
 * 模态对话框的公共外壳样式。
 *
 * 抽出来是因为「右键作图」和「右键改标签」两个对话框必须长得一样 —— 两处各抄一份
 * 颜色/圆角/间距，改一次忘一处就会慢慢走偏。这里只放外壳，不放内容：
 * 画布、选项、代码预览这些各自留在自己的对话框里。
 *
 * 尺寸差异用 styled(SharedPanel) 覆盖（比如标签对话框只要 420px 宽），
 * 不要在下游重写一遍背景色和阴影。
 */

export const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
  box-sizing: border-box;
`;

export const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 18px 20px 16px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  box-sizing: border-box;
`;

/**
 * 可拖动的对话框外壳。
 *
 * 为什么单独做一个而不是给 `Panel` 加 prop：拖动会改变定位方式（从「Backdrop 的
 * flex 居中」变成「fixed + translate」），而 `Panel` 自己还要被不需要拖动的对话框
 * 原样使用。这里用 `styled(Panel)` 继承全部外观，只覆写定位，两边的颜色/圆角不会分叉。
 *
 * 拖动用手柄而不是整个面板：面板里全是输入框和画布，按在它们身上要正常交互，
 * 不能顺手把对话框拖走。所以只有 `DialogDragHandle`（标题栏）负责拖动。
 */
export const DraggablePanel = styled(Panel)`
  position: fixed;
  top: 50%;
  left: 50%;
  margin: 0;
  /* 位移由 JS 通过内联 style 写入；这里给一个初始值，避免首次渲染跳动。 */
  transform: translate(-50%, -50%);
  will-change: transform;
`;

/**
 * 标题栏拖动条。包在 `DragHandle` 里的区域才响应拖动。
 *
 * `cursor: move` 之外还给了 `user-select: none`：不然拖动时会顺手把标题选中，
 * 松手后标题保持高亮，看起来像是出了 bug。
 */
export const DragHandle = styled.div`
  cursor: move;
  user-select: none;
  touch-action: none;
`;

/**
 * 让一个「固定在屏幕中央」的元素可以被拖走。
 *
 * 位置用**相对初始居中位置的像素偏移**表示，而不是绝对 left/top —— 面板的居中
 * 是 CSS `translate(-50%, -50%)` 算出来的，改成绝对定位就得自己量宽高，窗口一
 * 变化还要重算。存偏移量的话，面板尺寸、窗口大小怎么变都不会错位。
 *
 * 返回的 `offset` 加上 `translate` 即可；拖动距离用 `pointerdown` 那一刻的指针
 * 位置做基准，中途不会因为元素移动而累积漂移。
 */
export function useDragOffset(enabled = true) {
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

    const onPointerDown = useCallback((event: React.PointerEvent) => {
        if (!enabled) return;
        // 只响应鼠标左键 / 主指针，避免右键和中键也把面板拖走。
        if (event.button !== 0) return;
        // 点在关闭按钮之类的交互元素上时不要开始拖动：用户是想点它，不是想拖窗口。
        const target = event.target as HTMLElement;
        if (target.closest('button, input, select, textarea, a')) return;
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: offset.x,
            originY: offset.y,
        };
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }, [enabled, offset.x, offset.y]);

    const onPointerMove = useCallback((event: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setOffset({
            x: drag.originX + (event.clientX - drag.startX),
            y: drag.originY + (event.clientY - drag.startY),
        });
    }, []);

    const endDrag = useCallback((event: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }, []);

    return { offset, dragHandleProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag } };
}

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

export const Title = styled.h3`
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
`;

export const CloseButton = styled.button`
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    background: #f1f5f9;
    color: #1f2937;
  }
`;

export const Hint = styled.p`
  margin: 8px 0 12px;
  color: #475569;
  font-size: 0.82rem;
  line-height: 1.5;
`;

export const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
`;

/** 代码预览的小标题（「将插入的代码」「这一行将变成」）。 */
export const PreviewLabel = styled.div`
  margin-top: 14px;
  color: #64748b;
  font-size: 0.74rem;
`;

/** 等宽代码预览块。两个对话框的预览必须看起来是同一个东西。 */
export const CodePreview = styled.pre`
  margin: 6px 0 0;
  padding: 10px 12px;
  max-height: 140px;
  overflow: auto;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #0f172a;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  font-size: 0.76rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
`;

export const GhostButton = styled.button`
  padding: 7px 18px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: #ffffff;
  color: #475569;
  font-size: 0.82rem;
  cursor: pointer;

  &:hover {
    background: #f8fafc;
  }
`;

export const PrimaryButton = styled.button`
  padding: 7px 18px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #2563eb;
  color: #ffffff;
  font-size: 0.82rem;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: #1d4ed8;
  }

  &:disabled {
    border-color: #cbd5e1;
    background: #cbd5e1;
    cursor: default;
  }
`;
