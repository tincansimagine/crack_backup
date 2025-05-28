// ==UserScript==
// @name         뤼튼 크랙 채팅 백업
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  뤼튼 크랙(Wrtn Crack) 웹사이트에서 채팅 내역을 백업하는 스크립트
// @author       케츠
// @match        https://crack.wrtn.ai/*
// @icon         https://crack.wrtn.ai/favicon.ico
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 설정
    const CONFIG = {
        buttonText: '💾 채팅 백업',
        exportFormats: ['HTML', 'JSON', 'TXT'],
        maxRetries: 3,
        delayBetweenRequests: 1000
    };

    // 유틸리티 함수들
    const utils = {
        // 요소가 로드될 때까지 대기
        waitForElement(selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                const checkElement = () => {
                    const element = document.querySelector(selector);
                    if (element) {
                        resolve(element);
                    } else if (Date.now() - startTime > timeout) {
                        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
                    } else {
                        setTimeout(checkElement, 100);
                    }
                };
                checkElement();
            });
        },

        // 날짜 포맷팅
        formatDate(dateString) {
            if (!dateString) return '날짜 없음';
            const now = new Date();
            const date = new Date(dateString);

            if (isNaN(date.getTime())) return dateString;

            return date.toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        // 파일 다운로드
        downloadFile(content, filename, type = 'application/json') {
            const blob = new Blob([content], { type: type + ';charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        // 텍스트 정리
        sanitizeText(text) {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').trim();
        }
    };

    // 채팅 데이터 추출기
    class ChatExtractor {
        constructor() {
            this.chatList = [];
            this.currentChatMessages = [];
        }

        // 사이드바에서 채팅 목록 추출
        async extractChatList() {
            try {
                console.log('채팅 목록 추출 시작...');

                // 실제 사이드바 구조에 맞는 선택자들
                const sidebarSelectors = [
                    'aside',
                    '[class*="sidebar"]',
                    '[class*="side"]',
                    'nav',
                    '[class*="nav"]'
                ];

                let chatListContainer = null;
                for (const selector of sidebarSelectors) {
                    chatListContainer = document.querySelector(selector);
                    if (chatListContainer) break;
                }

                if (!chatListContainer) {
                    throw new Error('사이드바 컨테이너를 찾을 수 없습니다.');
                }

                // 채팅 항목들 찾기 - 다양한 선택자 시도
                const chatSelectors = [
                    'a[href*="/u/"][href*="/c/"]',
                    'a[href*="/c/"]',
                    'div[class*="chat"]',
                    '[class*="chat-item"]',
                    '[class*="conversation"]'
                ];

                let chatItems = [];
                for (const selector of chatSelectors) {
                    chatItems = chatListContainer.querySelectorAll(selector);
                    if (chatItems.length > 0) {
                        console.log(`${selector}로 ${chatItems.length}개 항목 발견`);
                        break;
                    }
                }

                if (chatItems.length === 0) {
                    throw new Error('채팅 항목을 찾을 수 없습니다.');
                }

                this.chatList = Array.from(chatItems).map((item, index) => {
                    const href = item.getAttribute('href') || item.querySelector('a')?.getAttribute('href');
                    const chatId = href ? href.split('/c/')[1] || `item_${index}` : `unknown_${index}`;
                    const unitId = href ? href.split('/u/')[1]?.split('/c/')[0] || 'unknown' : 'unknown';

                    // 캐릭터 이름 찾기
                    const nameSelectors = [
                        '.chat-list-item-character-name',
                        '[class*="character-name"]',
                        '[class*="name"]',
                        'h3', 'h4', 'h5',
                        '[class*="title"]'
                    ];

                    let characterName = '알 수 없는 캐릭터';
                    for (const selector of nameSelectors) {
                        const nameEl = item.querySelector(selector);
                        if (nameEl && nameEl.textContent.trim()) {
                            characterName = utils.sanitizeText(nameEl.textContent);
                            break;
                        }
                    }

                    // 마지막 메시지 찾기
                    const messageSelectors = [
                        '.chat-list-item-topic',
                        '[class*="topic"]',
                        '[class*="message"]',
                        '[class*="preview"]',
                        'p'
                    ];

                    let lastMessage = '';
                    for (const selector of messageSelectors) {
                        const msgEl = item.querySelector(selector);
                        if (msgEl && msgEl.textContent.trim()) {
                            lastMessage = utils.sanitizeText(msgEl.textContent);
                            break;
                        }
                    }

                    // 날짜 찾기
                    const dateSelectors = [
                        '.chat-update-date-label',
                        '[class*="date"]',
                        '[class*="time"]',
                        'time',
                        'span'
                    ];

                    let lastUpdated = '';
                    for (const selector of dateSelectors) {
                        const dateEl = item.querySelector(selector);
                        if (dateEl && dateEl.textContent.trim()) {
                            const text = utils.sanitizeText(dateEl.textContent);
                            if (text.includes('시간') || text.includes('분') || text.includes('일')) {
                                lastUpdated = text;
                                break;
                            }
                        }
                    }

                    // 캐릭터 아바타 이미지
                    const avatarEl = item.querySelector('img');
                    const avatarUrl = avatarEl ? avatarEl.src : '';

                    return {
                        chatId,
                        unitId,
                        characterName,
                        lastMessage,
                        lastUpdated,
                        avatarUrl,
                        chatUrl: href ? (href.startsWith('http') ? href : `https://crack.wrtn.ai${href}`) : '',
                        extractedAt: new Date().toISOString()
                    };
                });

                console.log('채팅 목록 추출 완료:', this.chatList);
                return this.chatList;
            } catch (error) {
                console.error('채팅 목록 추출 실패:', error);
                throw error;
            }
        }

        // 현재 채팅방의 메시지 추출
        async extractCurrentChatMessages() {
            try {
                console.log('현재 채팅 메시지 추출 시작...');

                const messageListElement = await utils.waitForElement('#character-message-list');
                if (!messageListElement) {
                    throw new Error('채팅 메시지 목록 컨테이너 (#character-message-list)를 찾을 수 없습니다.');
                }

                const messages = [];
                const messageItems = messageListElement.querySelectorAll('.message-item');
                console.log('발견된 메시지 아이템 수:', messageItems.length);

                let currentCharacterName = '알 수 없는 캐릭터'; // 현재 대화의 캐릭터 이름을 저장할 변수
                // 채팅방 상단에서 캐릭터 이름을 먼저 찾아본다.
                const headerCharacterNameEl = document.querySelector('p[class*="css-1ijub34"]'); // 예시 선택자, 실제 확인 필요
                if (headerCharacterNameEl && headerCharacterNameEl.textContent.trim()) {
                    currentCharacterName = headerCharacterNameEl.textContent.trim();
                }

                messageItems.forEach((item, index) => {
                    let author = '사용자'; // 기본값을 사용자로 설정
                    let content = []; // 메시지 내용을 배열로 저장 (텍스트와 이미지 모두 포함)
                    let timestamp = ''; // 타임스탬프는 현재 HTML 구조에서 명확하지 않아 비워둠
                    let avatar = '';

                    console.log(`메시지 아이템 ${index + 1} 처리 중...`);

                    // 캐릭터 메시지인지 확인 (캐릭터 이름 요소 존재 여부로 판단)
                    const characterNameElement = item.querySelector('span[class*="css-h6nvx3"]'); // 캐릭터 이름 선택자

                    if (characterNameElement && characterNameElement.textContent.trim()) {
                        // 캐릭터 메시지
                        author = characterNameElement.textContent.trim();
                        currentCharacterName = author; // 현재 캐릭터 이름 업데이트
                        const avatarElement = item.querySelector('.character_avatar img');
                        if (avatarElement) {
                            avatar = avatarElement.src;
                        }

                        // 캐릭터 메시지 내용 추출
                        const messageContainer = item.querySelector('.css-jswf15');
                        if (messageContainer) {
                            // 메시지 컨테이너의 직접 자식 요소들을 순서대로 처리
                            const childElements = messageContainer.children;

                            for (let childElement of childElements) {
                                if (childElement.classList.contains('css-l6zbeu')) {
                                    // 텍스트 콘텐츠
                                    let paragraphNodes = [];

                                    childElement.childNodes.forEach(node => {
                                        if (node.nodeType === Node.TEXT_NODE) {
                                            const text = node.textContent;
                                            if (text.trim()) {
                                                paragraphNodes.push({type: 'text', content: text});
                                            }
                                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                                            if (node.tagName === 'EM') {
                                                paragraphNodes.push({type: 'text', content: node.textContent, emphasis: true});
                                            } else if (node.tagName === 'BR') {
                                                paragraphNodes.push({type: 'linebreak'});
                                            } else {
                                                const nodeText = node.textContent;
                                                if (nodeText.trim()) {
                                                    paragraphNodes.push({type: 'text', content: nodeText});
                                                }
                                            }
                                        }
                                    });

                                    if (paragraphNodes.length > 0) {
                                        content.push({
                                            type: 'paragraph',
                                            nodes: paragraphNodes
                                        });
                                    }
                                } else if (childElement.classList.contains('css-obwzop')) {
                                    // 이미지 컨테이너
                                    const img = childElement.querySelector('img.css-1xeqs9p');
                                    if (img) {
                                        content.push({
                                            type: 'image',
                                            url: img.src,
                                            alt: img.alt || '이미지'
                                        });
                                    }
                                }
                            }
                        }

                    } else {
                        // 사용자 메시지로 간주 (캐릭터 이름 요소가 없는 경우)
                        console.log('사용자 메시지 감지됨:', index);

                        // 사용자 메시지 내용 추출 - 여러 선택자 시도
                        const userMessageContainer = item.querySelector('.css-jswf15');
                        if (userMessageContainer) {
                            // 메시지 컨테이너의 직접 자식 요소들을 순서대로 처리
                            const childElements = userMessageContainer.children;

                            for (let childElement of childElements) {
                                if (childElement.classList.contains('css-l8rc0l')) {
                                    // 사용자 텍스트 콘텐츠
                                    let paragraphNodes = [];

                                    childElement.childNodes.forEach(node => {
                                        if (node.nodeType === Node.TEXT_NODE) {
                                            const text = node.textContent;
                                            if (text.trim()) {
                                                paragraphNodes.push({type: 'text', content: text});
                                            }
                                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                                            if (node.tagName === 'EM') {
                                                paragraphNodes.push({type: 'text', content: node.textContent, emphasis: true});
                                            } else if (node.tagName === 'BR') {
                                                paragraphNodes.push({type: 'linebreak'});
                                            } else if (node.tagName === 'IMG') {
                                                paragraphNodes.push({
                                                    type: 'image',
                                                    url: node.src,
                                                    alt: node.alt || '이미지'
                                                });
                                            } else {
                                                const nodeText = node.textContent;
                                                if (nodeText.trim()) {
                                                    paragraphNodes.push({type: 'text', content: nodeText});
                                                }

                                                // 내부에 이미지가 있는지 확인
                                                const nestedImages = node.querySelectorAll('img');
                                                if (nestedImages.length > 0) {
                                                    nestedImages.forEach(img => {
                                                        paragraphNodes.push({
                                                            type: 'image',
                                                            url: img.src,
                                                            alt: img.alt || '이미지'
                                                        });
                                                    });
                                                }
                                            }
                                        }
                                    });

                                    if (paragraphNodes.length > 0) {
                                        content.push({
                                            type: 'paragraph',
                                            nodes: paragraphNodes
                                        });
                                    }
                                } else if (childElement.classList.contains('css-obwzop')) {
                                    // 이미지 컨테이너
                                    const img = childElement.querySelector('img.css-1xeqs9p');
                                    if (img) {
                                        content.push({
                                            type: 'image',
                                            url: img.src,
                                            alt: img.alt || '이미지'
                                        });
                                    }
                                }
                            }
                        }

                        // 위에서 찾지 못했다면 기존 방식으로 시도
                        if (content.length === 0) {
                            const userSelectors = [
                                '.message-bubble div[class*="css-l8rc0l"]',
                                '.message-bubble div[class*="user-message"]',
                                '.message-bubble div:not([class*="css-l6zbeu"])'
                            ];

                            let userMessageBubble = null;
                            for (const selector of userSelectors) {
                                userMessageBubble = item.querySelector(selector);
                                if (userMessageBubble) {
                                    console.log(`선택자로 사용자 메시지 발견: ${selector}`);
                                    break;
                                }
                            }

                            // 선택자로 찾지 못했다면 메시지 버블 직접 검색
                            if (!userMessageBubble) {
                                const allDivs = item.querySelectorAll('.message-bubble div');
                                console.log('메시지 버블 내 모든 div 수:', allDivs.length);

                                // 텍스트 내용이 있는 첫 번째 div 선택
                                for (const div of allDivs) {
                                    if (div.textContent.trim()) {
                                        userMessageBubble = div;
                                        console.log('텍스트 내용이 있는 div 발견:', div.textContent.substring(0, 20));
                                        break;
                                    }
                                }
                            }

                            if (userMessageBubble) {
                                let paragraphNodes = [];

                                userMessageBubble.childNodes.forEach(node => {
                                    if (node.nodeType === Node.TEXT_NODE) {
                                        const text = node.textContent;
                                        if (text.trim()) {
                                            paragraphNodes.push({type: 'text', content: text});
                                        }
                                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                                        if (node.tagName === 'EM') {
                                            paragraphNodes.push({type: 'text', content: node.textContent, emphasis: true});
                                        } else if (node.tagName === 'BR') {
                                            paragraphNodes.push({type: 'linebreak'});
                                        } else if (node.tagName === 'IMG') {
                                            paragraphNodes.push({
                                                type: 'image',
                                                url: node.src,
                                                alt: node.alt || '이미지'
                                            });
                                        } else {
                                            const nodeText = node.textContent;
                                            if (nodeText.trim()) {
                                                paragraphNodes.push({type: 'text', content: nodeText});
                                            }

                                            // 내부에 이미지가 있는지 확인
                                            const nestedImages = node.querySelectorAll('img');
                                            if (nestedImages.length > 0) {
                                                nestedImages.forEach(img => {
                                                    paragraphNodes.push({
                                                        type: 'image',
                                                        url: img.src,
                                                        alt: img.alt || '이미지'
                                                    });
                                                });
                                            }
                                        }
                                    }
                                });

                                if (paragraphNodes.length > 0) {
                                    content.push({
                                        type: 'paragraph',
                                        nodes: paragraphNodes
                                    });
                                    console.log('사용자 메시지 내용:', paragraphNodes.length, '개의 노드');
                                }
                            } else {
                                console.warn('사용자 메시지 버블을 찾을 수 없음:', index);
                            }
                        }
                    }

                    // 타임스탬프 추출 시도
                    const timeElement = item.querySelector('.message-bubble + div');
                    if (timeElement && timeElement.textContent.trim()) {
                        timestamp = timeElement.textContent.trim();
                    }

                    // 콘텐츠가 있는 경우에만 메시지 추가
                    if (content.length > 0) {
                        messages.push({
                            author: author,
                            content: content,
                            timestamp: timestamp || new Date().toISOString(),
                            avatar: avatar
                        });
                        console.log(`메시지 추가됨: ${author} (내용 길이: ${JSON.stringify(content).length})`);
                    } else {
                        console.warn(`메시지 내용이 없어 건너뜀: ${index}`);
                    }
                });

                this.currentChatMessages = messages;
                console.log('현재 채팅 메시지 추출 완료:', this.currentChatMessages.length);
                console.log('사용자 메시지 수:', this.currentChatMessages.filter(m => m.author === '사용자').length);

                // 채팅방 전체 정보를 반환 (캐릭터 이름 포함)
                const chatRoomTitleElement = document.querySelector('p[class*="css-1ijub34"]'); // 채팅방 제목 선택자 (캐릭터 이름과 동일할 수 있음)
                const chatRoomTitle = chatRoomTitleElement ? chatRoomTitleElement.textContent.trim() : currentCharacterName;


                return {
                    chatId: window.location.pathname.split('/c/')[1]?.split('/')[0] || 'unknown_chat_id',
                    unitId: window.location.pathname.split('/u/')[1]?.split('/')[0] || 'unknown_unit_id',
                    characterName: chatRoomTitle, // 채팅방의 대표 캐릭터 이름
                    messages: this.currentChatMessages,
                    extractedAt: new Date().toISOString()
                };

            } catch (error) {
                console.error('현재 채팅 메시지 추출 실패:', error);
                // 사용자에게 오류 메시지를 보여주는 로직 추가 가능
                const fallbackButton = document.getElementById('crack-backup-button');
                if (fallbackButton) {
                    fallbackButton.textContent = '백업 실패 (새로고침 후 재시도)';
                    fallbackButton.style.backgroundColor = 'red';
                }
                throw error; // 오류를 다시 throw하여 호출한 쪽에서 처리할 수 있도록 함
            }
        }

        // 전체 채팅 백업 (모든 채팅방 순회)
        async extractAllChats() {
            try {
                const chatList = await this.extractChatList();
                const allChatsData = {
                    summary: {
                        totalChats: chatList.length,
                        extractedAt: new Date().toISOString(),
                        source: 'Wrtn Crack (crack.wrtn.ai)'
                    },
                    chatList: chatList,
                    fullChats: []
                };

                // 백업 상태 객체 초기화
                this.backupStatus = {
                    totalChats: chatList.length,
                    processedChats: 0,
                    currentChat: '',
                    startTime: new Date(),
                    errors: []
                };

                // 로컬 스토리지에 진행 중인 백업 세션 저장
                localStorage.setItem('wrtn_backup_in_progress', 'true');
                localStorage.setItem('wrtn_backup_chat_list', JSON.stringify(chatList));

                // 이벤트를 통해 진행 상황 업데이트
                const updateProgress = () => {
                    const event = new CustomEvent('wrtn_backup_progress', {
                        detail: this.backupStatus
                    });
                    document.dispatchEvent(event);
                };

                // 각 채팅방 순회하여 메시지 추출
                // 한 번에 하나의 채팅방만 처리하는 방식으로 변경
                const processNextChat = async (index = 0) => {
                    if (index >= chatList.length) {
                        // 모든 채팅방 처리 완료
                        localStorage.removeItem('wrtn_backup_in_progress');
                        localStorage.removeItem('wrtn_backup_chat_list');
                        return allChatsData;
                    }

                    const chat = chatList[index];
                    this.backupStatus.currentChat = chat.characterName;
                    this.backupStatus.processedChats = index;
                    updateProgress();

                    try {
                        console.log(`채팅 ${index + 1}/${chatList.length} 처리 중: ${chat.characterName}`);

                        // 채팅방으로 이동
                        if (chat.chatUrl) {
                            // 현재 URL 저장
                            const currentUrl = window.location.href;
                            localStorage.setItem('wrtn_backup_current_index', index.toString());
                            localStorage.setItem('wrtn_backup_return_url', currentUrl);

                            // 페이지 이동
                            window.location.href = chat.chatUrl;
                            return null; // 페이지 이동 후 현재 함수 종료
                        }
                    } catch (error) {
                        console.error(`채팅 ${chat.characterName} 처리 실패:`, error);
                        this.backupStatus.errors.push({
                            chat: chat.characterName,
                            error: error.message
                        });
                        updateProgress();

                        allChatsData.fullChats.push({
                            ...chat,
                            error: error.message,
                            messages: []
                        });

                        // 다음 채팅으로 진행
                        return processNextChat(index + 1);
                    }
                };

                // 백업 프로세스 시작 또는 재개
                const inProgressIndex = parseInt(localStorage.getItem('wrtn_backup_current_index'), 10);
                if (!isNaN(inProgressIndex) && inProgressIndex < chatList.length) {
                    return processNextChat(inProgressIndex);
                } else {
                    return processNextChat(0);
                }

            } catch (error) {
                console.error('전체 채팅 백업 실패:', error);
                localStorage.removeItem('wrtn_backup_in_progress');
                localStorage.removeItem('wrtn_backup_chat_list');
                throw error;
            }
        }
    }

    // 백업 UI 생성
    class BackupUI {
        constructor() {
            this.extractor = new ChatExtractor();
            this.createUI();
        }

        async createUI() {
            try {
                // 상단 메뉴 컨테이너 찾기 (캐즘 버너 참고)
                await utils.waitForElement('.css-uxwch2');
                const menuContainer = document.querySelector('.css-uxwch2');

                if (!menuContainer || document.getElementById('crackBackupMenu')) {
                    return;
                }

                // 백업 메뉴 생성
                const backupWrap = document.createElement('div');
                backupWrap.id = 'crackBackupWrap';
                backupWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

                const backupMenu = document.createElement('div');
                backupMenu.id = 'crackBackupMenu';
                backupMenu.className = 'css-5w39sj'; // 캐즘 버너와 동일한 클래스 사용
                backupMenu.style.cssText = 'display: flex; cursor: pointer;';
                backupMenu.innerHTML = `
                    <p color="text_primary" class="css-1xke5yy">
                        <span style="padding-right: 6px;">💾</span>채팅 백업
                    </p>
                    <div class="css-13pmxen" style="display: flex;"></div>
                `;

                backupMenu.addEventListener('click', () => this.showBackupModal());

                backupWrap.appendChild(backupMenu);
                menuContainer.appendChild(backupWrap);

                console.log('💾 뤼튼 크랙 채팅 백업 메뉴가 추가되었습니다!');
            } catch (error) {
                console.error('백업 UI 생성 실패:', error);
                // 폴백: 기존 방식으로 버튼 생성
                this.createFallbackButton();
            }
        }

        createFallbackButton() {
            // 기존 버튼이 있다면 제거
            const existingButton = document.getElementById('crack-backup-button');
            if (existingButton) {
                existingButton.remove();
            }

            // 백업 버튼 스타일 - 더 눈에 띄게 수정
            const buttonStyle = `
                position: fixed;
                bottom: 30px;
                right: 30px;
                z-index: 99999;
                background: linear-gradient(45deg, #FF4432, #FF6B5A);
                color: white;
                border: none;
                border-radius: 50px;
                padding: 16px 24px;
                font-size: 16px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 6px 20px rgba(255, 68, 50, 0.4);
                transition: all 0.3s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                user-select: none;
                border: 2px solid rgba(255, 255, 255, 0.2);
            `;

            // 백업 버튼 생성
            this.backupButton = document.createElement('button');
            this.backupButton.id = 'crack-backup-button';
            this.backupButton.textContent = CONFIG.buttonText;
            this.backupButton.style.cssText = buttonStyle;
            this.backupButton.addEventListener('click', () => this.showBackupModal());

            // 호버 효과
            this.backupButton.addEventListener('mouseenter', () => {
                this.backupButton.style.transform = 'translateY(-3px) scale(1.05)';
                this.backupButton.style.boxShadow = '0 8px 25px rgba(255, 68, 50, 0.6)';
            });

            this.backupButton.addEventListener('mouseleave', () => {
                this.backupButton.style.transform = 'translateY(0) scale(1)';
                this.backupButton.style.boxShadow = '0 6px 20px rgba(255, 68, 50, 0.4)';
            });

            // 페이지에 버튼 추가
            document.body.appendChild(this.backupButton);
        }

        showBackupModal() {
            // 모달 오버레이
            const modalOverlay = document.createElement('div');
            modalOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 100000;
                display: flex;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(5px);
            `;

            // 모달 컨텐츠
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: white;
                border-radius: 16px;
                padding: 28px;
                max-width: 450px;
                width: 90%;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;

            modal.innerHTML = `
                <h2 style="margin: 0 0 24px 0; color: #1A1918; font-size: 24px; font-weight: 700; text-align: center;">💾 채팅 백업</h2>
                <div style="margin-bottom: 24px;">
                    <button id="backup-current" style="
                        width: 100%;
                        padding: 16px;
                        margin-bottom: 12px;
                        background: linear-gradient(45deg, #FF4432, #FF6B5A);
                        color: white;
                        border: none;
                        border-radius: 10px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    ">🔥 현재 채팅방 백업</button>

                    <button id="backup-list" style="
                        width: 100%;
                        padding: 16px;
                        margin-bottom: 12px;
                        background: linear-gradient(45deg, #1A88FF, #4FA8FF);
                        color: white;
                        border: none;
                        border-radius: 10px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    ">📋 채팅 목록만 백업</button>

                    <button id="backup-all" style="
                        width: 100%;
                        padding: 16px;
                        margin-bottom: 24px;
                        background: linear-gradient(45deg, #2CAA00, #4BC934);
                        color: white;
                        border: none;
                        border-radius: 10px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    ">🌟 전체 채팅 백업 (시간 소요)</button>
                </div>

                <div style="margin-bottom: 24px;">
                    <label style="display: block; margin-bottom: 10px; color: #61605A; font-size: 15px; font-weight: 600;">📄 내보내기 형식:</label>
                    <select id="export-format" style="
                        width: 100%;
                        padding: 12px 16px;
                        border: 2px solid #E5E5E1;
                        border-radius: 8px;
                        font-size: 15px;
                        background: white;
                        cursor: pointer;
                    ">
                        <option value="html" selected>🌐 예쁜 HTML (추천)</option>
                        <option value="json">📊 JSON (프로그램용)</option>
                        <option value="txt">📝 TXT (텍스트)</option>
                    </select>
                </div>

                <div style="display: flex; gap: 12px;">
                    <button id="modal-close" style="
                        flex: 1;
                        padding: 12px;
                        background: #F0EFEB;
                        color: #61605A;
                        border: none;
                        border-radius: 8px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    ">❌ 취소</button>
                </div>

                <div id="backup-progress" style="
                    display: none;
                    margin-top: 20px;
                    padding: 16px;
                    background: #F7F7F5;
                    border-radius: 8px;
                    font-size: 15px;
                    color: #61605A;
                    text-align: center;
                    font-weight: 600;
                "></div>

                <div id="progress-bar-container" style="
                    display: none;
                    margin-top: 12px;
                    background: #E5E5E1;
                    border-radius: 10px;
                    height: 10px;
                    overflow: hidden;
                ">
                    <div id="progress-bar" style="
                        height: 100%;
                        width: 0%;
                        background: linear-gradient(45deg, #FF4432, #FF6B5A);
                        transition: width 0.3s ease;
                    "></div>
                </div>
            `;

            modalOverlay.appendChild(modal);
            document.body.appendChild(modalOverlay);

            // 버튼 호버 효과
            const buttons = modal.querySelectorAll('button:not(#modal-close)');
            buttons.forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    btn.style.transform = 'translateY(-2px)';
                    btn.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.2)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.transform = 'translateY(0)';
                    btn.style.boxShadow = 'none';
                });
            });

            // 이벤트 리스너
            document.getElementById('backup-current').addEventListener('click', () => this.backupCurrentChat(modal));
            document.getElementById('backup-list').addEventListener('click', () => this.backupChatList(modal));
            document.getElementById('backup-all').addEventListener('click', () => this.backupAllChats(modal));
            document.getElementById('modal-close').addEventListener('click', () => document.body.removeChild(modalOverlay));

            // 오버레이 클릭시 닫기
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    document.body.removeChild(modalOverlay);
                }
            });

            // 백업 진행 중인 경우 체크
            const inProgress = localStorage.getItem('wrtn_backup_in_progress') === 'true';
            if (inProgress) {
                this.resumeBackupProcess(modal);
            }
        }

        showProgress(modal, message, percent = -1) {
            const progressEl = modal.querySelector('#backup-progress');
            const progressBarContainer = modal.querySelector('#progress-bar-container');
            const progressBar = modal.querySelector('#progress-bar');

            progressEl.style.display = 'block';
            progressEl.textContent = message;

            if (percent >= 0) {
                progressBarContainer.style.display = 'block';
                progressBar.style.width = `${percent}%`;
            }
        }

        // 백업 프로세스 재개 (페이지 로드 후)
        async resumeBackupProcess(modal) {
            try {
                const inProgress = localStorage.getItem('wrtn_backup_in_progress') === 'true';
                const currentIndex = parseInt(localStorage.getItem('wrtn_backup_current_index'), 10);
                const returnUrl = localStorage.getItem('wrtn_backup_return_url');
                const chatListStr = localStorage.getItem('wrtn_backup_chat_list');

                if (!inProgress || isNaN(currentIndex) || !chatListStr) {
                    return;
                }

                const chatList = JSON.parse(chatListStr);
                const currentChat = chatList[currentIndex];

                if (!currentChat) {
                    return;
                }

                // 현재 URL이 처리해야 할 채팅방 URL과 일치하는지 확인
                const currentPathname = window.location.pathname;
                const targetPathname = new URL(currentChat.chatUrl, window.location.origin).pathname;

                if (currentPathname === targetPathname) {
                    // 현재 채팅방에서 메시지 추출
                    this.showProgress(modal || this.createTemporaryProgressModal(),
                        `🔄 ${currentChat.characterName} 채팅 백업 중... (${currentIndex + 1}/${chatList.length})`,
                        (currentIndex / chatList.length) * 100);

                    try {
                        // 페이지 로드를 위한 짧은 대기
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        // 메시지 추출
                        const chatData = await this.extractor.extractCurrentChatMessages();

                        // 채팅 데이터 로그 출력 (디버깅용)
                        console.log('추출된 채팅 데이터:', chatData);
                        console.log('메시지 수:', chatData.messages.length);
                        console.log('사용자 메시지 수:', chatData.messages.filter(m => m.author === '사용자').length);

                        if (chatData.messages.length === 0) {
                            console.warn('채팅 메시지가 추출되지 않았습니다. 다시 시도합니다...');
                            // 메시지가 없으면 잠시 기다렸다가 다시 시도
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            const retryData = await this.extractor.extractCurrentChatMessages();

                            if (retryData.messages.length > 0) {
                                console.log('재시도 성공! 메시지 수:', retryData.messages.length);
                                chatData.messages = retryData.messages;
                            }
                        }

                        // 결과 저장 (로컬 스토리지에)
                        const backupResults = JSON.parse(localStorage.getItem('wrtn_backup_results') || '{"fullChats":[]}');
                        backupResults.fullChats.push({
                            ...currentChat,
                            ...chatData
                        });
                        localStorage.setItem('wrtn_backup_results', JSON.stringify(backupResults));

                        // 다음 채팅방으로 이동 또는 완료
                        const nextIndex = currentIndex + 1;
                        if (nextIndex < chatList.length) {
                            localStorage.setItem('wrtn_backup_current_index', nextIndex.toString());
                            const nextChat = chatList[nextIndex];
                            window.location.href = nextChat.chatUrl;
                        } else {
                            // 백업 완료, 최종 결과 처리
                            this.showProgress(modal || this.createTemporaryProgressModal(),
                                '✅ 모든 채팅 백업 완료! 결과 다운로드 준비 중...', 100);

                            const finalResults = {
                                summary: {
                                    totalChats: chatList.length,
                                    extractedAt: new Date().toISOString(),
                                    source: 'Wrtn Crack (crack.wrtn.ai)'
                                },
                                chatList: chatList,
                                fullChats: backupResults.fullChats
                            };

                            // 결과 다운로드
                            const format = localStorage.getItem('wrtn_backup_format') || 'html';
                            this.exportData(finalResults, 'wrtn-crack-all-chats', format);

                            // 임시 데이터 정리
                            localStorage.removeItem('wrtn_backup_in_progress');
                            localStorage.removeItem('wrtn_backup_current_index');
                            localStorage.removeItem('wrtn_backup_chat_list');
                            localStorage.removeItem('wrtn_backup_return_url');
                            localStorage.removeItem('wrtn_backup_results');
                            localStorage.removeItem('wrtn_backup_format');

                            // 시작 페이지로 복귀 (옵션)
                            if (returnUrl) {
                                setTimeout(() => {
                                    window.location.href = returnUrl;
                                }, 3000);
                            }
                        }
                    } catch (error) {
                        console.error('채팅 백업 중 오류:', error);
                        this.showProgress(modal || this.createTemporaryProgressModal(),
                            `❌ 오류: ${error.message}. 다음 채팅으로 진행합니다.`);

                        // 오류가 발생해도 다음 채팅으로 진행
                        const nextIndex = currentIndex + 1;
                        if (nextIndex < chatList.length) {
                            setTimeout(() => {
                                localStorage.setItem('wrtn_backup_current_index', nextIndex.toString());
                                const nextChat = chatList[nextIndex];
                                window.location.href = nextChat.chatUrl;
                            }, 2000);
                        }
                    }
                }
            } catch (error) {
                console.error('백업 재개 중 오류:', error);
            }
        }

        // 임시 진행 상황 모달 (페이지 전환 후 표시용)
        createTemporaryProgressModal() {
            // 기존 모달이 있으면 제거
            const existingModal = document.getElementById('temp-backup-modal');
            if (existingModal) {
                return existingModal;
            }

            // 새 모달 생성
            const modalOverlay = document.createElement('div');
            modalOverlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 100000;
                display: flex;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(5px);
            `;

            const modal = document.createElement('div');
            modal.id = 'temp-backup-modal';
            modal.style.cssText = `
                background: white;
                border-radius: 16px;
                padding: 28px;
                max-width: 450px;
                width: 90%;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            `;

            modal.innerHTML = `
                <h2 style="margin: 0 0 24px 0; color: #1A1918; font-size: 24px; font-weight: 700; text-align: center;">💾 채팅 백업 진행 중</h2>

                <div id="backup-progress" style="
                    margin-top: 20px;
                    padding: 16px;
                    background: #F7F7F5;
                    border-radius: 8px;
                    font-size: 15px;
                    color: #61605A;
                    text-align: center;
                    font-weight: 600;
                ">백업 진행 중...</div>

                <div id="progress-bar-container" style="
                    margin-top: 12px;
                    background: #E5E5E1;
                    border-radius: 10px;
                    height: 10px;
                    overflow: hidden;
                ">
                    <div id="progress-bar" style="
                        height: 100%;
                        width: 0%;
                        background: linear-gradient(45deg, #FF4432, #FF6B5A);
                        transition: width 0.3s ease;
                    "></div>
                </div>

                <button id="cancel-backup" style="
                    width: 100%;
                    padding: 12px;
                    margin-top: 24px;
                    background: #F0EFEB;
                    color: #61605A;
                    border: none;
                    border-radius: 8px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                ">❌ 백업 취소</button>
            `;

            modalOverlay.appendChild(modal);
            document.body.appendChild(modalOverlay);

            // 취소 버튼 이벤트
            modal.querySelector('#cancel-backup').addEventListener('click', () => {
                localStorage.removeItem('wrtn_backup_in_progress');
                localStorage.removeItem('wrtn_backup_current_index');
                localStorage.removeItem('wrtn_backup_chat_list');
                localStorage.removeItem('wrtn_backup_return_url');
                localStorage.removeItem('wrtn_backup_results');
                document.body.removeChild(modalOverlay);
            });

            return modal;
        }

        async backupCurrentChat(modal) {
            try {
                this.showProgress(modal, '🔄 현재 채팅방 백업 중...');
                const chatData = await this.extractor.extractCurrentChatMessages();
                const format = document.getElementById('export-format').value;

                this.exportData(chatData, `wrtn-crack-chat-${chatData.characterName || chatData.chatId}`, format);
                this.showProgress(modal, '✅ 백업 완료!');

                setTimeout(() => {
                    document.body.removeChild(modal.closest('[style*="position: fixed"]'));
                }, 2000);
            } catch (error) {
                this.showProgress(modal, `❌ 오류: ${error.message}`);
                console.error('백업 오류:', error);
            }
        }

        async backupChatList(modal) {
            try {
                this.showProgress(modal, '🔄 채팅 목록 백업 중...');
                const chatList = await this.extractor.extractChatList();
                const format = document.getElementById('export-format').value;

                const data = {
                    summary: {
                        totalChats: chatList.length,
                        extractedAt: new Date().toISOString(),
                        source: 'Wrtn Crack (crack.wrtn.ai)'
                    },
                    chatList: chatList
                };

                this.exportData(data, 'wrtn-crack-chat-list', format);
                this.showProgress(modal, '✅ 백업 완료!');

                setTimeout(() => {
                    document.body.removeChild(modal.closest('[style*="position: fixed"]'));
                }, 2000);
            } catch (error) {
                this.showProgress(modal, `❌ 오류: ${error.message}`);
                console.error('백업 오류:', error);
            }
        }

        async backupAllChats(modal) {
            try {
                // 백업 시작 시 포맷 저장
                const format = document.getElementById('export-format').value;
                localStorage.setItem('wrtn_backup_format', format);

                // 초기 상태 표시
                this.showProgress(modal, '🔄 전체 채팅 백업 준비 중...', 0);

                // 채팅 목록 가져오기
                const chatList = await this.extractor.extractChatList();
                if (!chatList || chatList.length === 0) {
                    throw new Error('채팅 목록을 가져올 수 없습니다.');
                }

                // 백업 시작
                this.showProgress(
                    modal,
                    `🔄 전체 채팅 백업 시작... (총 ${chatList.length}개)`,
                    0
                );

                // 초기 백업 상태 설정
                localStorage.setItem('wrtn_backup_in_progress', 'true');
                localStorage.setItem('wrtn_backup_current_index', '0');
                localStorage.setItem('wrtn_backup_chat_list', JSON.stringify(chatList));
                localStorage.setItem('wrtn_backup_return_url', window.location.href);
                localStorage.setItem('wrtn_backup_results', JSON.stringify({fullChats: []}));

                // 첫 번째 채팅방으로 이동하여 백업 시작
                if (chatList.length > 0) {
                    window.location.href = chatList[0].chatUrl;
                }

            } catch (error) {
                this.showProgress(modal, `❌ 오류: ${error.message}`);
                console.error('백업 오류:', error);

                // 백업 상태 초기화
                localStorage.removeItem('wrtn_backup_in_progress');
                localStorage.removeItem('wrtn_backup_current_index');
                localStorage.removeItem('wrtn_backup_chat_list');
                localStorage.removeItem('wrtn_backup_return_url');
                localStorage.removeItem('wrtn_backup_results');
            }
        }

        exportData(data, filename, format) {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

            switch (format) {
                case 'json':
                    utils.downloadFile(
                        JSON.stringify(data, null, 2),
                        `${filename}_${timestamp}.json`,
                        'application/json'
                    );
                    break;

                case 'html':
                    const htmlContent = this.generateHTML(data);
                    utils.downloadFile(
                        htmlContent,
                        `${filename}_${timestamp}.html`,
                        'text/html'
                    );
                    break;

                case 'txt':
                    const txtContent = this.generateTXT(data);
                    utils.downloadFile(
                        txtContent,
                        `${filename}_${timestamp}.txt`,
                        'text/plain'
                    );
                    break;
            }
        }

        generateHTML(data) {
            let html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.characterName || '뤼튼 크랙'} - 채팅 백업</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
            background: #0a0a0a;
            color: #ffffff;
            line-height: 1.6;
        }

        /* 헤더 스타일 */
        .header {
            background: #141414;
            border-bottom: 1px solid #2a2a2a;
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(10px);
            background: rgba(20, 20, 20, 0.95);
        }

        .header-content {
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .character-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid #FF4432;
        }

        .character-info h1 {
            font-size: 20px;
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 4px;
        }

        .character-info .meta {
            font-size: 13px;
            color: #8a8a8a;
        }

        /* 채팅 컨테이너 */
        .chat-container {
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            min-height: calc(100vh - 100px);
        }

        /* 메시지 스타일 */
        .message {
            margin-bottom: 20px;
            animation: fadeIn 0.3s ease-in;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message.user {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }

        .message.ai {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }

        .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }

        .message.user .message-header {
            display: none; /* 사용자 메시지는 헤더 숨김 */
        }

        .message-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            flex-shrink: 0;
            object-fit: cover;
        }

        .message-author {
            font-size: 14px;
            font-weight: 600;
            color: #ffffff;
        }

        .message-content {
            max-width: 65%;
            background: #1a1a1a;
            padding: 12px 18px;
            border-radius: 18px;
            position: relative;
        }

        .message.user .message-content {
            background: #FF4432;
            color: white;
        }

        .message-text {
            font-size: 15px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .message-text em {
            font-style: italic;
            opacity: 0.9;
        }

        .message-time {
            font-size: 11px;
            color: #6a6a6a;
            margin-top: 6px;
            align-self: flex-start;
        }

        .message.user .message-time {
            color: rgba(255, 255, 255, 0.7);
            align-self: flex-end;
        }

        /* 메시지 내 이미지 스타일 */
        .message-image {
            max-width: 100%;
            border-radius: 12px;
            margin: 8px 0;
            display: block;
        }

        .message-paragraph {
            margin-bottom: 12px;
        }

        .message-paragraph:last-child {
            margin-bottom: 0;
        }

        /* 날짜 구분선 */
        .date-divider {
            text-align: center;
            margin: 30px 0;
            position: relative;
        }

        .date-divider::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            width: 100%;
            height: 1px;
            background: #2a2a2a;
        }

        .date-divider span {
            background: #0a0a0a;
            padding: 0 16px;
            color: #6a6a6a;
            font-size: 13px;
            position: relative;
        }

        /* 채팅 목록 스타일 */
        .chat-list {
            max-width: 700px; /* PC에서 너비 제한 */
            margin: 0 auto;
            padding: 20px;
        }

        .chat-item {
            background: #1a1a1a;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            display: flex;
            gap: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            color: inherit;
        }

        .chat-item:hover {
            background: #222;
            transform: translateX(4px);
        }

        .chat-item-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
        }

        .chat-item-content {
            flex: 1;
            overflow: hidden;
        }

        .chat-item-name {
            font-weight: 600;
            margin-bottom: 4px;
            color: #FF4432;
        }

        .chat-item-preview {
            font-size: 14px;
            color: #8a8a8a;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .chat-item-time {
            font-size: 12px;
            color: #6a6a6a;
            margin-top: 4px;
        }

        /* 전체 채팅 컨테이너 스타일 */
        .all-chats-container {
            display: none; /* 기본적으로 숨김 */
        }

        .all-chats-container.active {
            display: block;
        }

        /* 채팅방 탭 스타일 */
        .sticky-chat-list {
            position: sticky;
            top: 90px;
            z-index: 90;
            background: #141414;
            border-bottom: 1px solid #2a2a2a;
            margin-bottom: 20px;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .sticky-chat-list.hidden {
            transform: translateY(-100%);
            opacity: 0;
        }

        .chat-list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            max-width: 900px;
            margin: 0 auto;
        }

        .chat-list-header h2 {
            font-size: 18px;
            font-weight: 600;
            color: #FF4432;
            margin: 0;
        }

        .toggle-list-btn {
            background: #2a2a2a;
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            color: #aaa;
        }

        .toggle-list-btn:hover {
            background: #333;
            transform: scale(1.1);
        }

        .toggle-list-btn svg {
            transition: transform 0.3s ease;
        }

        .chat-list-header.collapsed .toggle-list-btn svg {
            transform: rotate(-90deg);
        }

        .chat-list-items {
            max-width: 900px;
            margin: 0 auto;
            padding: 0 20px 15px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 12px;
            max-height: 300px;
            overflow-y: auto;
            transition: all 0.3s ease;
        }

        .chat-list-items.collapsed {
            max-height: 0;
            padding: 0 20px;
            overflow: hidden;
        }

        .chat-list-link {
            text-decoration: none;
            color: inherit;
        }

        .sticky-chat-list .chat-item {
            background: #1a1a1a;
            border-radius: 8px;
            padding: 12px;
            display: flex;
            gap: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
            margin: 0;
        }

        .sticky-chat-list .chat-item:hover {
            background: #222;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .sticky-chat-list .chat-item-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
        }

        .sticky-chat-list .chat-item-content {
            flex: 1;
            overflow: hidden;
        }

        .sticky-chat-list .chat-item-name {
            font-weight: 600;
            font-size: 14px;
            color: #fff;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .chat-item-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            color: #6a6a6a;
        }

        .chat-item-id {
            color: #FF4432;
            font-weight: 600;
        }

        /* 채팅 섹션 스타일 */
        .all-chats-wrapper {
            max-width: 900px;
            margin: 0 auto;
        }

        .chat-section {
            margin-bottom: 100px; /* 섹션 간 간격 증가 */
            scroll-margin-top: 140px;
        }

        .chat-section:last-child {
            margin-bottom: 60px;
        }

        .chat-section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background: #1a1a1a;
            border-radius: 12px 12px 0 0;
            margin-bottom: -1px;
        }

        .chat-section-header h2 {
            color: #FF4432;
            margin: 0;
            font-size: 20px;
        }

        .chat-section-number {
            background: #FF4432;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }

        .chat-section .chat-container {
            background: #0a0a0a;
            border: 1px solid #2a2a2a;
            border-radius: 0 0 12px 12px;
            padding: 20px;
        }

        /* 스크롤바 스타일 */
        .chat-list-items::-webkit-scrollbar {
            width: 6px;
        }

        .chat-list-items::-webkit-scrollbar-track {
            background: #1a1a1a;
            border-radius: 3px;
        }

        .chat-list-items::-webkit-scrollbar-thumb {
            background: #FF4432;
            border-radius: 3px;
        }

        .chat-list-items::-webkit-scrollbar-thumb:hover {
            background: #FF5B4A;
        }

        /* 백 투 탑 버튼 */
        .back-to-top {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #FF4432;
            color: white;
            border: none;
            border-radius: 50%;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); /* 흐린 빛 효과 제거 */
            transition: all 0.3s ease;
            opacity: 0;
            visibility: hidden;
        }

        .back-to-top.visible {
            opacity: 1;
            visibility: visible;
        }

        .back-to-top:hover {
            background: #FF5B4A;
            transform: translateY(-3px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); /* 흐린 빛 효과 제거 */
        }

        /* 모바일 최적화 */
        @media screen and (max-width: 768px) {
            .message-content {
                max-width: 85%; /* 모바일에서 메시지 버블 너비 확장 */
                padding: 10px 14px;
                font-size: 14px;
            }

            .chat-container {
                padding: 15px 10px;
            }

            .header-content {
                padding: 15px;
            }

            .message {
                margin-bottom: 16px;
            }

            .message-avatar {
                width: 28px;
                height: 28px;
            }

            .sticky-chat-list {
                top: 70px;
            }

            .chat-list-header {
                padding: 12px 15px;
            }

            .chat-list-header h2 {
                font-size: 16px;
            }

            .chat-list-items {
                grid-template-columns: 1fr;
                gap: 8px;
                padding: 0 15px 12px;
                max-height: 250px;
            }

            .sticky-chat-list .chat-item {
                padding: 10px;
            }

            .sticky-chat-list .chat-item-avatar {
                width: 36px;
                height: 36px;
            }

            .chat-section {
                scroll-margin-top: 120px;
                margin-bottom: 40px;
            }

            .chat-section-header {
                padding: 15px;
            }

            .chat-section-header h2 {
                font-size: 18px;
            }

            .back-to-top {
                width: 40px;
                height: 40px;
                bottom: 20px;
                right: 20px;
            }

            .date-divider {
                margin: 20px 0;
            }

            .date-divider span {
                font-size: 12px;
            }
        }

        /* 더 작은 모바일 화면 */
        @media screen and (max-width: 480px) {
            .message-content {
                max-width: 90%; /* 더 작은 화면에서 메시지 버블 너비 최대화 */
            }

            .chat-container {
                padding: 10px 8px;
            }

            .chat-list-header h2 {
                font-size: 14px;
            }

            .toggle-list-btn {
                width: 28px;
                height: 28px;
            }

            .sticky-chat-list .chat-item-name {
                font-size: 13px;
            }

            .chat-item-meta {
                font-size: 11px;
            }
        }

        /* 푸터 */
        .footer {
            text-align: center;
            padding: 40px 20px;
            color: #6a6a6a;
            font-size: 13px;
            border-top: 1px solid #2a2a2a;
            margin-top: 60px;
        }

        /* 백업 정보 배너 */
        .backup-info {
            background: linear-gradient(135deg, #FF4432 0%, #FF6B5A 100%);
            color: white;
            padding: 16px;
            text-align: center;
            font-size: 14px;
        }

        /* 스크롤바 스타일 */
        ::-webkit-scrollbar {
            width: 8px;
        }

        ::-webkit-scrollbar-track {
            background: #0a0a0a;
        }

        ::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
    </style>
</head>
<body>
`;

            // 백업 정보 배너
            html += `
    <div class="backup-info">
        💾 이 파일은 ${utils.formatDate(data.extractedAt || new Date().toISOString())}에 백업되었습니다.
    </div>
`;

            // 채팅방 백업인 경우
            if (data.messages) {
                html += `
    <div class="header">
        <div class="header-content">
            ${data.avatarUrl ? `<img src="${data.avatarUrl}" alt="${data.characterName}" class="character-avatar">` : ''}
            <div class="character-info">
                <h1>${data.characterName || '채팅'}</h1>
                <div class="meta">메시지 ${data.messages.length}개 • ${utils.formatDate(data.extractedAt)}</div>
            </div>
        </div>
    </div>

    <div class="chat-container">
`;

                // 메시지들을 날짜별로 그룹화
                let currentDate = '';
                data.messages.forEach((msg, index) => {
                    // 날짜 구분선 (필요한 경우)
                    const msgDate = new Date(msg.timestamp).toLocaleDateString('ko-KR');
                    if (msgDate !== currentDate) {
                        currentDate = msgDate;
                        html += `
        <div class="date-divider">
            <span>${currentDate}</span>
        </div>
`;
                    }

                    // 메시지
                    const isUser = msg.author === '사용자';

                    html += `
        <div class="message ${isUser ? 'user' : 'ai'}">
`;

                    // 캐릭터 메시지인 경우 헤더 추가
                    if (!isUser) {
                        html += `
            <div class="message-header">
                ${msg.avatar ? `<img src="${msg.avatar}" alt="${msg.author}" class="message-avatar">` : `<div class="message-avatar" style="background: linear-gradient(135deg, #FF4432 0%, #FF6B5A 100%);"></div>`}
                <span class="message-author">${msg.author}</span>
            </div>
`;
                    }

                    html += `
            <div class="message-content">
`;

                    // 메시지 콘텐츠 렌더링 - 순서대로 렌더링하여 이미지 위치 보존
                    if (msg.content) {
                        msg.content.forEach(contentItem => {
                            if (contentItem.type === 'paragraph') {
                                html += `<div class="message-paragraph">`;

                                contentItem.nodes.forEach(node => {
                                    if (node.type === 'text') {
                                        if (node.emphasis) {
                                            html += `<em>${this.escapeHtml(node.content)}</em>`;
                                        } else {
                                            html += this.escapeHtml(node.content);
                                        }
                                    } else if (node.type === 'linebreak') {
                                        html += '<br>';
                                    } else if (node.type === 'image') {
                                        html += `<img src="${node.url}" alt="${node.alt || '이미지'}" class="message-image">`;
                                    }
                                });

                                html += `</div>`;
                            } else if (contentItem.type === 'image') {
                                html += `<img src="${contentItem.url}" alt="${contentItem.alt || '이미지'}" class="message-image">`;
                            }
                        });
                    } else if (msg.message) {
                        // 이전 버전과의 호환성
                        html += `<div class="message-text">${this.escapeHtml(msg.message)}</div>`;
                    }

                    html += `
            </div>
            ${msg.timestamp ? `<div class="message-time">${msg.timestamp}</div>` : ''}
        </div>
`;
                });

                html += `
    </div>
`;
            }

            // 채팅 목록인 경우
            if (data.chatList) {
                html += `
    <div class="header">
        <div class="header-content">
            <div class="character-info">
                <h1>채팅 목록</h1>
                <div class="meta">총 ${data.chatList.length}개의 채팅</div>
            </div>
        </div>
    </div>
`;

                // 채팅 목록 표시 (전체 채팅 백업인 경우 탭 추가)
                if (data.fullChats && data.fullChats.length > 0) {
                    html += `
    <div class="sticky-chat-list">
        <div class="chat-list-header">
            <h2>💬 전체 채팅 목록 (${data.fullChats.length}개)</h2>
            <button class="toggle-list-btn" onclick="toggleChatList()">
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="20" height="20">
                    <path d="M7 10l5 5 5-5z"/>
                </svg>
            </button>
        </div>
        <div class="chat-list-items" id="chat-list-items">
`;
                    // 각 채팅방에 대한 목록 아이템 생성
                    data.fullChats.forEach((chat, idx) => {
                        html += `
            <a href="#chat-section-${idx}" class="chat-list-link" onclick="scrollToChat(event, 'chat-section-${idx}')">
                <div class="chat-item">
                    ${chat.avatarUrl ? `<img src="${chat.avatarUrl}" alt="${chat.characterName}" class="chat-item-avatar">` : `<div class="chat-item-avatar" style="background: linear-gradient(135deg, #FF4432 0%, #FF6B5A 100%);"></div>`}
                    <div class="chat-item-content">
                        <div class="chat-item-name">${chat.characterName}</div>
                        <div class="chat-item-meta">
                            <span class="chat-item-count">${chat.messages ? chat.messages.length : 0}개 메시지</span>
                            <span class="chat-item-id">#${idx + 1}</span>
                        </div>
                    </div>
                </div>
            </a>`;
                    });

                    html += `
        </div>
    </div>
`;
                } else {
                    html += `
    <div class="chat-list">
`;
                }

                data.chatList.forEach((chat, idx) => {
                    html += `
        <div class="chat-item">
            ${chat.avatarUrl ? `<img src="${chat.avatarUrl}" alt="${chat.characterName}" class="chat-item-avatar">` : `<div class="chat-item-avatar" style="background: linear-gradient(135deg, #FF4432 0%, #FF6B5A 100%);"></div>`}
            <div class="chat-item-content">
                <div class="chat-item-name">${chat.characterName}</div>
                <div class="chat-item-preview">${chat.lastMessage}</div>
                <div class="chat-item-time">${chat.lastUpdated}</div>
            </div>
        </div>
`;
                });

                html += `
    </div>
`;
            }

            // 전체 채팅인 경우
            if (data.fullChats) {
                html += `
    <div class="all-chats-wrapper">
`;
                // 각 채팅방의 내용을 섹션으로 분리
                data.fullChats.forEach((chat, idx) => {
                    html += `
    <div id="chat-section-${idx}" class="chat-section">
        <div class="chat-section-header">
            <h2>${chat.characterName}</h2>
            <span class="chat-section-number">#${idx + 1}</span>
        </div>
        <div class="chat-container">
`;
                    if (chat.messages && chat.messages.length > 0) {
                        // 메시지들을 날짜별로 그룹화
                        let currentDate = '';
                        chat.messages.forEach((msg, index) => {
                            // 날짜 구분선 (필요한 경우)
                            const msgDate = new Date(msg.timestamp || msg.extractedAt || new Date()).toLocaleDateString('ko-KR');
                            if (msgDate !== currentDate) {
                                currentDate = msgDate;
                                html += `
        <div class="date-divider">
            <span>${currentDate}</span>
        </div>
`;
                            }

                            const isUser = msg.author === '사용자';
                            html += `
        <div class="message ${isUser ? 'user' : 'ai'}">
`;

                            // 캐릭터 메시지인 경우 헤더 추가
                            if (!isUser) {
                                html += `
            <div class="message-header">
                ${msg.avatar ? `<img src="${msg.avatar}" alt="${msg.author}" class="message-avatar">` : `<div class="message-avatar" style="background: linear-gradient(135deg, #FF4432 0%, #FF6B5A 100%);"></div>`}
                <span class="message-author">${msg.author}</span>
            </div>
`;
                            }

                            html += `
            <div class="message-content">
`;
                            // 메시지 콘텐츠 렌더링 - 순서대로 렌더링하여 이미지 위치 보존
                            if (msg.content) {
                                msg.content.forEach(contentItem => {
                                    if (contentItem.type === 'paragraph') {
                                        html += `<div class="message-paragraph">`;

                                        contentItem.nodes.forEach(node => {
                                            if (node.type === 'text') {
                                                if (node.emphasis) {
                                                    html += `<em>${this.escapeHtml(node.content)}</em>`;
                                                } else {
                                                    html += this.escapeHtml(node.content);
                                                }
                                            } else if (node.type === 'linebreak') {
                                                html += '<br>';
                                            } else if (node.type === 'image') {
                                                html += `<img src="${node.url}" alt="${node.alt || '이미지'}" class="message-image">`;
                                            }
                                        });

                                        html += `</div>`;
                                    } else if (contentItem.type === 'image') {
                                        html += `<img src="${contentItem.url}" alt="${contentItem.alt || '이미지'}" class="message-image">`;
                                    }
                                });
                            } else if (msg.message) {
                                // 이전 버전과의 호환성
                                html += `<div class="message-text">${this.escapeHtml(msg.message)}</div>`;
                            }

                            html += `
            </div>
            ${msg.timestamp ? `<div class="message-time">${msg.timestamp}</div>` : ''}
        </div>
`;
                        });
                    } else {
                        html += `<p style="color: #6a6a6a; text-align: center;">메시지가 없습니다.</p>`;
                    }
                    html += `
    </div>
`;
                });
                html += `
    </div>
`;
            }

            // 자바스크립트 추가
            html += `
    <button class="back-to-top" id="backToTop" onclick="scrollToTop()">
        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="24" height="24">
            <path d="M7 14l5-5 5 5z"/>
        </svg>
    </button>

    <script>
        // 채팅 목록 토글 기능
        function toggleChatList() {
            const header = document.querySelector('.chat-list-header');
            const items = document.getElementById('chat-list-items');

            header.classList.toggle('collapsed');
            items.classList.toggle('collapsed');
        }

        // 부드러운 스크롤 기능
        function scrollToChat(event, chatId) {
            event.preventDefault();
            const element = document.getElementById(chatId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // 맨 위로 스크롤
        function scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // 백 투 탑 버튼 표시/숨김
        window.addEventListener('scroll', function() {
            const backToTop = document.getElementById('backToTop');
            if (window.scrollY > 300) {
                backToTop.classList.add('visible');
            } else {
                backToTop.classList.remove('visible');
            }
        });

        // 모바일에서 스크롤 시 헤더 숨기기/보이기
        let lastScrollTop = 0;
        let scrollTimeout;
        const stickyList = document.querySelector('.sticky-chat-list');

        function handleScroll() {
            // 모바일에서만 동작
            if (window.innerWidth <= 768 && stickyList) {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

                clearTimeout(scrollTimeout);

                if (scrollTop > lastScrollTop && scrollTop > 100) {
                    // 아래로 스크롤 - 헤더 숨기기
                    stickyList.classList.add('hidden');
                } else {
                    // 위로 스크롤 - 헤더 보이기
                    stickyList.classList.remove('hidden');
                }

                // 스크롤이 멈췄을 때 헤더 다시 보이기
                scrollTimeout = setTimeout(() => {
                    if (scrollTop < 200) {
                        stickyList.classList.remove('hidden');
                    }
                }, 1000);

                lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
            }
        }

        window.addEventListener('scroll', handleScroll, { passive: true });

        // 현재 보고 있는 채팅 하이라이트
        const observerOptions = {
            root: null,
            rootMargin: '-100px 0px -70% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const id = entry.target.id;
                const link = document.querySelector(\`a[href="#\${id}"]\`);

                if (link) {
                    if (entry.isIntersecting) {
                        // 현재 보고 있는 섹션의 링크 하이라이트
                        document.querySelectorAll('.chat-list-link').forEach(l => {
                            l.querySelector('.chat-item').style.borderLeft = 'none';
                        });
                        link.querySelector('.chat-item').style.borderLeft = '3px solid #FF4432';
                    }
                }
            });
        }, observerOptions);

        // 모든 채팅 섹션 관찰
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.chat-section').forEach(section => {
                observer.observe(section);
            });

            // 모바일에서 기본적으로 채팅 목록 접기
            if (window.innerWidth < 768) {
                const header = document.querySelector('.chat-list-header');
                const items = document.getElementById('chat-list-items');
                if (header && items) {
                    header.classList.add('collapsed');
                    items.classList.add('collapsed');
                }
            }
        });
    </script>

    <!-- 푸터 -->
    <div class="footer">
        <p>Wrtn Crack Chat Backup</p>
        <p>Powered by 뤼튼 크랙 채팅 백업 스크립트 v${GM_info?.script?.version || '1.0.0'}</p>
    </div>
</body>
</html>
`;
            return html;
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        generateTXT(data) {
            let txt = '💾 뤼튼 크랙 채팅 백업\n';
            txt += '========================\n';
            txt += `백업 생성일: ${utils.formatDate(new Date().toISOString())}\n\n`;

            if (data.summary) {
                txt += '📊 백업 요약\n';
                txt += '--------\n';
                txt += `총 채팅 수: ${data.summary.totalChats || 0}개\n`;
                txt += `백업 생성일: ${utils.formatDate(data.summary.extractedAt)}\n`;
                txt += `출처: ${data.summary.source}\n\n`;
            }

            if (data.chatList) {
                txt += '📋 채팅 목록\n';
                txt += '--------\n';
                data.chatList.forEach((chat, index) => {
                    txt += `${index + 1}. ${chat.characterName}\n`;
                    txt += `   마지막 업데이트: ${chat.lastUpdated}\n`;
                    txt += `   마지막 메시지: ${chat.lastMessage}\n\n`;
                });
            }

            if (data.messages) {
                txt += `💬 ${data.characterName || '채팅'} - 메시지\n`;
                txt += '----------\n';
                data.messages.forEach((msg, index) => {
                    const speaker = msg.author === '사용자' ? '👤 나' : `🤖 ${data.characterName || 'AI'}`;
                    txt += `[${index + 1}] ${speaker}:\n`;

                    if (msg.content) {
                        msg.content.forEach(contentItem => {
                            if (contentItem.type === 'paragraph') {
                                let paragraphText = '';
                                contentItem.nodes.forEach(node => {
                                    if (node.type === 'text') {
                                        paragraphText += node.content;
                                    } else if (node.type === 'linebreak') {
                                        paragraphText += '\n';
                                    } else if (node.type === 'image') {
                                        paragraphText += `[이미지: ${node.alt}] (${node.url})\n`;
                                    }
                                });
                                txt += paragraphText + '\n';
                            } else if (contentItem.type === 'image') {
                                txt += `[이미지: ${contentItem.alt}] (${contentItem.url})\n`;
                            }
                        });
                    } else if (msg.message) {
                        txt += msg.message + '\n';
                    }

                    txt += '\n';
                });
            }

            if (data.fullChats) {
                txt += '📚 전체 채팅 내역\n';
                txt += '=============\n';
                data.fullChats.forEach((chat, chatIndex) => {
                    txt += `\n채팅 ${chatIndex + 1}: ${chat.characterName}\n`;
                    txt += `메시지 수: ${chat.messages ? chat.messages.length : 0}개\n`;
                    txt += '----------------------------------------\n';

                    if (chat.messages) {
                        chat.messages.forEach((msg, msgIndex) => {
                            const speaker = msg.author === '사용자' ? '👤 나' : `🤖 ${chat.characterName}`;
                            txt += `[${msgIndex + 1}] ${speaker}:\n`;

                            if (msg.content) {
                                msg.content.forEach(contentItem => {
                                    if (contentItem.type === 'paragraph') {
                                        let paragraphText = '';
                                        contentItem.nodes.forEach(node => {
                                            if (node.type === 'text') {
                                                paragraphText += node.content;
                                            } else if (node.type === 'linebreak') {
                                                paragraphText += '\n';
                                            } else if (node.type === 'image') {
                                                paragraphText += `[이미지: ${node.alt}] (${node.url})\n`;
                                            }
                                        });
                                        txt += paragraphText + '\n';
                                    } else if (contentItem.type === 'image') {
                                        txt += `[이미지: ${contentItem.alt}] (${contentItem.url})\n`;
                                    }
                                });
                            } else if (msg.message) {
                                txt += msg.message + '\n';
                            }

                            txt += '\n';
                        });
                    }
                    txt += '\n';
                });
            }

            return txt;
        }
    }

    // 스크립트 초기화
    async function initScript() {
        console.log('🚀 뤼튼 크랙 채팅 백업 스크립트 초기화 중...');

        // 페이지 로드 시 백업 진행 상태 확인
        const inProgress = localStorage.getItem('wrtn_backup_in_progress') === 'true';

        // URL 체크
        if (window.location.pathname.match(/\/u\/[a-f0-9]+\/c\/[a-f0-9]+/)) {
            console.log('✅ 채팅방 페이지 감지됨');

            // BackupUI 인스턴스 생성
            try {
                const ui = new BackupUI();

                // 백업 진행 중이면 자동으로 재개
                if (inProgress) {
                    console.log('🔄 백업 진행 중 감지, 프로세스 재개...');
                    setTimeout(() => {
                        ui.resumeBackupProcess();
                    }, 1000);
                }

                console.log('✅ 백업 UI 생성 완료!');
            } catch (error) {
                console.error('❌ 백업 UI 생성 실패:', error);
            }
        } else {
            console.log('⚠️ 채팅방이 아닙니다. 메인 페이지에서만 백업 기능이 활성화됩니다.');

            // 메인 페이지에서도 백업 상태를 확인하고 UI 초기화
            if (window.location.pathname === '/' || window.location.pathname.match(/^\/u\/[a-f0-9]+$/)) {
                try {
                    new BackupUI();
                } catch (error) {
                    console.error('❌ 백업 UI 생성 실패:', error);
                }
            }
        }
    }

    // 페이지 로드 및 URL 변경 감지
    function watchForChanges() {
        let lastUrl = location.href;

        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                initScript();
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // 페이지가 뤼튼 크랙인지 확인 후 초기화
    if (window.location.hostname === 'crack.wrtn.ai') {
        // 초기 실행
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initScript);
        } else {
            setTimeout(initScript, 1000);
        }

        // URL 변경 감지
        watchForChanges();

        console.log('💾 뤼튼 크랙 채팅 백업 스크립트가 로드되었습니다.');
    } else {
        console.log('⚠️ 뤼튼 크랙 웹사이트가 아닙니다. 스크립트를 건너뜁니다.');
    }

})();