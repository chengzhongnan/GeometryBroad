import React, { useState, useEffect, useRef, type FormEvent } from 'react';
import styled from 'styled-components';
import OpenAI from 'openai';
import type { Message } from 'ai';
import { FiSave, FiSettings, FiSend, FiTrash2 } from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import { SettingsModal, getChatAISetting } from './SettingsModal';

import systemPromptContent from '../assets/SystemPrompt.txt?raw';

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface AIChatPanelProps {
    title: string;
}

const CHAT_HISTORY_KEY = 'chat-history';

const AIChatPanel: React.FC<AIChatPanelProps> = () => {
    // --- 2. 手动管理状态 ---
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const [apiSettings, setApiSettings] = useState<ReturnType<typeof getChatAISetting>>(getChatAISetting());

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);

    const systemPrompt: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: systemPromptContent,
    }

    // 组件首次加载时，从 localStorage 恢复聊天记录
    useEffect(() => {
        const savedHistory = localStorage.getItem(CHAT_HISTORY_KEY);
        if (savedHistory) {
            setMessages(JSON.parse(savedHistory));
        }
    }, []);

    // 自动滚动到最新消息
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        // 只有在消息列表不为空且AI没有在响应时才保存
        // 这可以防止在流式输出的每一帧都保存，也避免了覆盖初始状态
        if (messages.length > 0 && !isLoading) {
            localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
        }
    }, [messages, isLoading]); // 依赖于 messages 和 isLoading

    // 实现核心的 handleSubmit 函数 ---
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        if (!apiSettings.apiKey || !apiSettings.apiUrl || !apiSettings.model) {
            alert('Please set your API Key, Base URL, and Model in settings first.');
            return;
        }

        const newUserMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
        };

        const newMessages = [...messages, newUserMessage];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            // 初始化 OpenAI 客户端
            const openai = new OpenAI({
                apiKey: apiSettings.apiKey,
                baseURL: apiSettings.apiUrl,
                dangerouslyAllowBrowser: true,
            });

            const apiMessages: MessageParam[] = [systemPrompt as MessageParam, ...(newMessages.slice(-5).map(({ id, ...rest }) => rest) as MessageParam[])]

            const stream = await openai.chat.completions.create({
                model: apiSettings.model!,
                messages: apiMessages, // API 不需要 id
                stream: true,
            });

            // 创建一个助手的初始空消息
            const assistantId = Date.now().toString();
            const assistantMessage: Message = {
                id: assistantId,
                role: 'assistant',
                content: '',
            };
            setMessages(prev => [...prev, assistantMessage]);

            // 处理流式响应
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === assistantId
                            ? { ...msg, content: msg.content + delta }
                            : msg
                    )
                );
            }

        } catch (error) {
            console.error("Error calling OpenAI API:", error);
            const errorMessage: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: 'An error occurred. Please check your API key, endpoint, and console for details.'
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: any) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // 阻止换行
            formRef.current?.requestSubmit(); // 以编程方式提交表单
        }
    };

    const handleClearHistory = () => {
        if (window.confirm('Are you sure you want to clear the chat history?')) {
            setMessages([]);
            localStorage.removeItem(CHAT_HISTORY_KEY);
        }
    };

    return (
        <PanelContainer>
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => {
                    setIsSettingsOpen(false);
                    setApiSettings(getChatAISetting()); // 重新获取并更新设置
                }}
            />

            <Header>
                <IconButton onClick={handleClearHistory} title="Clear Chat History">
                    <FiTrash2 />
                </IconButton>
                <IconButton onClick={() => setIsSettingsOpen(true)} title="API Settings">
                    <FiSettings />
                </IconButton>
            </Header>

            <MessagesContainer>
                {messages.length > 0 ? (
                    messages.map(m => (
                        <MessageBubble key={m.id} $isUser={m.role === 'user'}>
                            <ReactMarkdown>
                                {m.content}
                            </ReactMarkdown>
                        </MessageBubble>
                    ))
                ) : (
                    // 添加空状态提示
                    <EmptyState>
                        <p>和AI对话完成自动化绘图</p>
                    </EmptyState>
                )}
                <div ref={messagesEndRef} />
            </MessagesContainer>

            {/* 将 ref 和 onKeyDown 绑定到表单和输入框 */}
            <InputForm ref={formRef} onSubmit={handleSubmit}>
                <ChatInput
                    value={input}
                    placeholder="输入你的绘图需求，让AI自动生成绘图代码"
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)} // 修正类型
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                />
                <SendButton type="submit" disabled={isLoading} title="Send Message">
                    <FiSend />
                </SendButton>
            </InputForm>
        </PanelContainer>
    );
};

// --- Styles (与之前完全相同，无需改动) ---
const PanelContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
`;
const Header = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-bottom: 0.75rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
`;
const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  font-size: 1.25rem;
  color: #6b7280;
  transition: color 0.2s ease;

  &:hover {
    color: #4f46e5;
  }
`;
const MessagesContainer = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  padding: 0 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;
const MessageBubble = styled.div<{ $isUser: boolean }>`
  max-width: 100%;
  padding: 0.5rem 1rem;
  border-radius: 1rem;
  word-wrap: break-word;
  align-self: ${props => (props.$isUser ? 'flex-end' : 'flex-start')};
  background-color: ${props => (props.$isUser ? '#4f46e5' : '#f3f4f6')};
  color: ${props => (props.$isUser ? '#ffffff' : '#1f2937')};
  font-size: 0.95rem;
  line-height: 1.6;

  p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote {
    margin-top: 0;
    margin-bottom: 0.75rem;
    &:last-child {
      margin-bottom: 0;
    }
  }

  pre {
    background-color: ${props => (props.$isUser ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)')};
    padding: 0.75rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.85rem;
    /* 关键改动：使用 'pre-wrap' 来保留空格和换行符，
      同时允许文本在超出容器时自动换行。
    */
    white-space: pre-wrap;
  }

  code {
    background-color: ${props => (props.$isUser ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)')};
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.85rem;
  }
  
  pre > code {
    background-color: transparent;
    padding: 0;
    /* 对于 pre 内部的 code，也需要设置换行规则，
      因为有时候长单词或字符串也需要被强制换行。
    */
    word-break: break-all;
  }

  a {
    color: ${props => (props.$isUser ? '#a5b4fc' : '#3b82f6')};
    text-decoration: underline;
    &:hover {
      text-decoration: none;
    }
  }
  
  ul, ol {
    padding-left: 1.5rem;
  }
`;
const InputForm = styled.form`
  display: flex;
  padding-top: 1rem;
  flex-shrink: 0;
  gap: 0.5rem;
`;
const ChatInput = styled.textarea`
  flex-grow: 1;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0.75rem;
  font-size: 1rem;
  resize: none;
  height: 75px;

  &:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 1px #4f46e5;
  }
`;
const SendButton = styled.button`
  flex-shrink: 0;
  width: 50px;
  height: 50px;
  border: none;
  background-color: #4f46e5;
  color: white;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 1.5rem;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #4338ca;
  }

  &:disabled {
    background-color: #a5b4fc;
    cursor: not-allowed;
  }
`;

const EmptyState = styled.div`
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #9ca3af;
  font-style: italic;
  text-align: center;
`;

export default AIChatPanel;