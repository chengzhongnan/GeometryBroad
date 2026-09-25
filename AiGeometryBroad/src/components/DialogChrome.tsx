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
