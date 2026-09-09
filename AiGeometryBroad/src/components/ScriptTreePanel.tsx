// ScriptTreePanel.tsx
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { v4 as uuidv4 } from 'uuid'; // 用于生成唯一ID，需安装: npm install uuid @types/uuid
import TreeNode, { type FileNodeData } from './TreeNode';
import ContextMenu from './ScriptTreeContentMenu';
import { FaFileMedical, FaFolderPlus } from 'react-icons/fa'; 

interface ScriptTreePanelProps {
  title: string;
}

// Context Menu State Type
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  node: FileNodeData | null;
}

const ScriptTreePanel: React.FC<ScriptTreePanelProps> = ({ title }) => {
  const initialFiles: FileNodeData[] = [
    {
      id: '1', name: 'scripts', type: 'folder', children: [
        { id: '2', name: 'create_geometry.geo', type: 'file', content: '#...' },
      ]
    },
    { id: '4', name: 'README.md', type: 'file', content: '#...' },
  ];

  const [files, setFiles] = useState<FileNodeData[]>(initialFiles);
  const [activeFile, setActiveFile] = useState<FileNodeData | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, node: null });

  // --- 右键菜单相关逻辑 ---

  const handleContextMenu = useCallback((event: React.MouseEvent, node: FileNodeData | null) => {
    event.preventDefault();
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY, node });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    if (contextMenu.visible) {
      window.addEventListener('click', handleCloseContextMenu);
    }
    return () => {
      window.removeEventListener('click', handleCloseContextMenu);
    };
  }, [contextMenu.visible, handleCloseContextMenu]);

  // --- 文件和文件夹操作 ---

  // 查找并删除节点
  const deleteNodeFromTree = (nodes: FileNodeData[], nodeId: string): FileNodeData[] => {
    return nodes.filter(node => node.id !== nodeId).map(node => {
      if (node.children) {
        node.children = deleteNodeFromTree(node.children, nodeId);
      }
      return node;
    });
  };

  // 查找并重命名节点
  const renameNodeInTree = (nodes: FileNodeData[], nodeId: string, newName: string): FileNodeData[] => {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, name: newName };
      }
      if (node.children) {
        return { ...node, children: renameNodeInTree(node.children, nodeId, newName) };
      }
      return node;
    });
  };

  // 查找并在文件夹中添加新节点
  const addNodeToFolderInTree = (nodes: FileNodeData[], folderId: string, newNode: FileNodeData): FileNodeData[] => {
    return nodes.map(node => {
      if (node.id === folderId && node.type === 'folder') {
        return { ...node, children: [...(node.children || []), newNode] };
      }
      if (node.children) {
        return { ...node, children: addNodeToFolderInTree(node.children, folderId, newNode) };
      }
      return node;
    });
  };

  const handleAddNewFile = () => {
    const newFileName = `new_script_${Math.floor(Math.random() * 100)}.geo`;
    const newFile: FileNodeData = {
      id: uuidv4(),
      name: newFileName,
      type: 'file',
      content: `# ${newFileName}\n\n`,
    };

    // 将新文件添加到根目录
    setFiles(prevFiles => [...prevFiles, newFile]);
    // 自动选中新文件
    setActiveFile(newFile);
  };

  const createNewNode = (type: 'file' | 'folder', name: string): FileNodeData => ({
    id: uuidv4(),
    name,
    type,
    content: type === 'file' ? `# New script: ${name}\n` : undefined,
    children: type === 'folder' ? [] : undefined,
  });

  const handleNewFile = (folderId?: string) => {
    const fileName = window.prompt("Enter new file name:", "new_script.geo");
    if (!fileName) return;
    const newNode = createNewNode('file', fileName);
    if (folderId) {
      setFiles(prev => addNodeToFolderInTree(prev, folderId, newNode));
    } else {
      setFiles(prev => [...prev, newNode]);
    }
  };

  const handleNewFolder = (folderId?: string) => {
    const folderName = window.prompt("Enter new folder name:", "new_folder");
    if (!folderName) return;
    const newNode = createNewNode('folder', folderName);
    if (folderId) {
      setFiles(prev => addNodeToFolderInTree(prev, folderId, newNode));
    } else {
      setFiles(prev => [...prev, newNode]);
    }
  };

  const handleRename = (node: FileNodeData) => {
    const newName = window.prompt(`Enter new name for "${node.name}":`, node.name);
    if (newName && newName !== node.name) {
      setFiles(prev => renameNodeInTree(prev, node.id, newName));
      if (activeFile?.id === node.id) {
        setActiveFile(prev => prev ? { ...prev, name: newName } : null);
      }
    }
  };

  const handleDelete = (node: FileNodeData) => {
    if (window.confirm(`Are you sure you want to delete "${node.name}"?`)) {
      setFiles(prev => deleteNodeFromTree(prev, node.id));
      if (activeFile?.id === node.id) {
        setActiveFile(null);
      }
    }
  };

  // --- 编辑器相关逻辑 (与之前版本类似) ---
  const handleSelectFile = useCallback((node: FileNodeData) => {
    if (node.type === 'file') setActiveFile(node);
  }, []);

  const handleScriptChange = useCallback((newScript: string) => {
    if (!activeFile) return;
    setActiveFile(prev => prev ? { ...prev, content: newScript } : null);
    setFiles(prevFiles => renameNodeInTree(prevFiles, activeFile.id, activeFile.name).map(n =>
      n.id === activeFile.id ? { ...n, content: newScript } : n)); // Simplified update for active file
  }, [activeFile]);

  const handleExecute = (script: string) => {
    console.log("Executing script:", script);
  };

  return (
    <PanelWrapper>
      <Sidebar onContextMenu={(e) => handleContextMenu(e, null)}>
      <SidebarHeader>
            <span>EXPLORER</span>
            <ActionButtons>
                <ActionButton onClick={() => handleNewFile()} title="New File">
                    <FaFileMedical />
                </ActionButton>
                <ActionButton onClick={() => handleNewFolder()} title="New Folder">
                    <FaFolderPlus />
                </ActionButton>
            </ActionButtons>
          </SidebarHeader>
        {files.map(node => (
          <TreeNode
            key={node.id}
            node={node}
            onSelectFile={handleSelectFile}
            activeFileId={activeFile?.id || null}
            level={0}
            onContextMenu={handleContextMenu}
          />
        ))}
      </Sidebar>
      {contextMenu.visible && (
        <ContextMenu 
          x={contextMenu.x} 
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={handleCloseContextMenu}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </PanelWrapper>
  );
};

// --- Styles ---
const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ActionButton = styled.button`
  background: none;
  border: none;
  color: #cccccc;
  font-size: 16px;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  &:hover {
    color: white;
  }
`;


const PanelWrapper = styled.div`
  display: flex;
  height: 80vh; /* 或者设置为您需要的高度 */
  width: 100%;
  background-color: #1e1e1e; /* VS Code 暗色背景 */
  border: 1px solid #333;
`;

const Sidebar = styled.div`
  width: 100%;
  background-color: #252526;
  border-right: 1px solid #333;
  padding-top: 5px;
  overflow-y: auto;
`;

const SidebarHeader = styled.div`
    padding: 10px;
    font-size: 12px;
    font-weight: bold;
    color: #cccccc;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #333;
    margin-bottom: 5px;
`;

const AddFileButton = styled.button`
    background: none;
    border: none;
    color: #cccccc;
    font-size: 20px;
    cursor: pointer;
    &:hover {
        color: white;
    }
`;

export default ScriptTreePanel;