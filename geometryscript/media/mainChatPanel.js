(function () {
    // 全局变量
    let currentTaskId = null;
    let messages = [];

    // 处理输入变化
    function handleInputChange() {
        const input = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        sendButton.disabled = !input.value.trim();
    }

    // 处理键盘事件
    function handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    }

    // 发送消息
    function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();

        if (!message) return;

        // 添加消息到历史记录
        messages.push({
            type: 'user',
            content: message,
            timestamp: new Date()
        });

        // 清空输入框
        input.value = '';
        handleInputChange();

        // 模拟AI响应
        setTimeout(() => {
            const aiResponse = generateAIResponse(message);
            messages.push({
                type: 'ai',
                content: aiResponse,
                timestamp: new Date()
            });

            // 这里可以更新UI显示对话内容
            updateMainContent();
        }, 1000);

        // 立即更新UI
        updateMainContent();
    }

    // 生成AI响应（模拟）
    function generateAIResponse(userMessage) {
        const responses = [
            "我理解您的需求，让我来帮您分析一下这个问题。",
            "这是一个有趣的问题，我需要查看相关代码才能给出准确的建议。",
            "根据您的描述，我建议我们按以下步骤进行：1. 首先检查错误日志 2. 分析代码结构 3. 提供修复方案",
            "让我帮您解决这个问题。我需要先了解一下当前的代码结构。"
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }

    // 加载任务
    function loadTask(taskId) {
        currentTaskId = taskId;

        // 模拟加载任务数据
        const taskData = {
            1: {
                title: "Fix the following code in @/src/PikafishWasmLoader.ts",
                description: "修复 PikafishWasmLoader.ts 文件中的代码问题",
                tokens: "1160.3k | 4.6k"
            },
            2: {
                title: "Fix the following code in @/src/PikafishWasmLoader.ts",
                description: "修复 PikafishWasmLoader.ts 文件中的另一个问题",
                tokens: "161.6k | 230"
            },
            3: {
                title: "Fix the following code in @/src/PikafishWorker.ts",
                description: "修复 PikafishWorker.ts 文件中的代码问题",
                tokens: "159.7k | 501"
            }
        };

        const task = taskData[taskId];
        if (task) {
            messages = [
                {
                    type: 'system',
                    content: `已加载任务: ${task.title}`,
                    timestamp: new Date()
                }
            ];
            updateMainContent();

            // 高亮选中的任务
            document.querySelectorAll('.task-item').forEach((item, index) => {
                if (index + 1 === taskId) {
                    item.style.backgroundColor = '#094771';
                } else {
                    item.style.backgroundColor = '';
                }
            });
        }
    }

    // 查看所有历史记录
    function viewAllHistory() {
        alert('查看所有历史记录功能');
    }

    // 更新主内容区域
    function updateMainContent() {
        const mainContent = document.querySelector('.main-content');

        if (messages.length === 0) {
            mainContent.innerHTML = '选择一个任务开始对话或输入新的任务';
            return;
        }

        let html = '<div style="max-width: 800px; width: 100%;">';

        messages.forEach(message => {
            const time = message.timestamp.toLocaleTimeString();
            const messageClass = message.type === 'user' ? 'user-message' : 'ai-message';

            html += `
            <div style="margin-bottom: 20px; padding: 12px; border-radius: 8px; 
                       background-color: ${message.type === 'user' ? '#2d2d30' : '#1e1e1e'};
                       border-left: 4px solid ${message.type === 'user' ? '#0078d4' : '#00aa00'};">
                <div style="font-size: 12px; color: #858585; margin-bottom: 8px;">
                    ${message.type === 'user' ? '用户' : 'AI'} - ${time}
                </div>
                <div style="color: #cccccc; line-height: 1.5;">
                    ${message.content}
                </div>
            </div>
        `;
        });

        html += '</div>';
        mainContent.innerHTML = html;

        // 滚动到底部
        mainContent.scrollTop = mainContent.scrollHeight;
    }

    // 初始化
    document.addEventListener('DOMContentLoaded', function () {
        // 设置输入框自动调整高度
        const input = document.getElementById('chatInput');
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // 初始化发送按钮状态
        handleInputChange();
    });
}())
