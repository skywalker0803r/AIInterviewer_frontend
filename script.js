const BACKEND_BASE_URL = "https://aiinterviewer-backend-924124779607.asia-east1.run.app";


// --- Global State ---
let selectedJob = null;
let mediaRecorder = null;
let audioChunks = [];
let currentSessionId = null;
let currentQuestionNumber = 0;
let totalQuestions = 0;
let userMediaStream = null; // New global variable to store the media stream
let audioStreamForRecording = null; // New: For the stream used by MediaRecorder

// --- DOM Ready ---
$(document).ready(function () {
    // --- Event Listeners ---
    $('#search-btn').on('click', handleSearchJobs);
    $('#start-interview').on('click', handleStartInterview);
    $('#record-btn').on('click', toggleRecording);
    $('#end-interview').on('click', handleEndInterview);
    $('#restart-interview').on('click', handleRestartInterview);
    // Dynamically bind click event for job list items
    $('#job-list').on('click', 'div', handleSelectJob);
});

// --- API Communication Functions ---

async function api_getJobs(keyword) {
    console.log(`[API] 正在請求職缺列表，關鍵字: ${keyword}`);
    try {
        const response = await $.get(`${BACKEND_BASE_URL}/jobs?keyword=${encodeURIComponent(keyword)}`);
        console.log(`[API] 成功獲取職缺列表。`);
        return response;
    } catch (error) {
        console.error(`[API] 獲取職缺列表失敗:`, error);
        throw error;
    }
}

async function api_startInterview(jobData) {
    console.log(`[API] 正在發送啟動面試請求，職位: ${jobData.job.title}`);
    try {
        const response = await $.ajax({
            url: `${BACKEND_BASE_URL}/start_interview`,
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify(jobData)
        });
        console.log(`[API] 啟動面試請求成功，會話ID: ${response.session_id}`);
        return response;
    } catch (error) {
        console.error(`[API] 啟動面試請求失敗:`, error);
        throw error;
    }
}

async function api_submitAnswer(sessionId, audioBlob) {
    console.log(`[API] 正在提交答案並獲取下一個問題，會話ID: ${sessionId}，音訊大小: ${audioBlob.size} 字節`);
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('audio_file', audioBlob, 'user_answer.webm');

    try {
        const response = await $.ajax({
            url: `${BACKEND_BASE_URL}/submit_answer_and_get_next_question`,
            method: "POST",
            data: formData,
            processData: false,
            contentType: false
        });
        console.log(`[API] 答案提交成功，收到下一個問題或面試結束通知。`);
        return response;
    } catch (error) {
        console.error(`[API] 提交答案失敗:`, error);
        throw error;
    }
}

async function api_getReport(sessionId) {
    console.log(`[API] 正在請求面試報告，會話ID: ${sessionId}`);
    try {
        const response = await $.get(`${BACKEND_BASE_URL}/get_interview_report?session_id=${sessionId}`);
        console.log(`[API] 成功獲取面試報告。`);
        return response;
    } catch (error) {
        console.error(`[API] 獲取面試報告失敗:`, error);
        throw error;
    }
}

async function api_endInterview(sessionId) {
    console.log(`[API] 正在發送結束面試請求，會話ID: ${sessionId}`);
    try {
        const response = await $.ajax({
            url: `${BACKEND_BASE_URL}/end_interview`,
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ session_id: sessionId })
        });
        console.log(`[API] 結束面試請求成功。`);
        return response;
    } catch (error) {
        console.error(`[API] 結束面試請求失敗:`, error);
        throw error;
    }
}

// --- Event Handlers ---

async function handleSearchJobs() {
    console.log("點擊了 '搜尋職缺' 按鈕。");
    const keyword = $('#job-input').val().trim();
    if (!keyword) {
        alert("請輸入職缺名稱");
        console.warn("職缺關鍵字為空。");
        return;
    }

    $('#job-list').html("<p class='text-gray-500'>正在搜尋中...</p>");
    console.log(`發送職缺搜尋請求，關鍵字: '{keyword}'。`);
    const startTime = performance.now();
    try {
        const res = await api_getJobs(keyword);
        const endTime = performance.now();
        console.log(`職缺搜尋請求完成，耗時: ${(endTime - startTime).toFixed(2)} 毫秒。`);
        console.log("接收到職缺數據:", res);
        const jobs = res.jobs;
        if (!jobs || jobs.length === 0) {
            $('#job-list').html("<p class='text-red-500'>查無職缺</p>");
            console.info("未找到職缺。");
            return;
        }
        // Store jobs data on a parent element to access later
        $('#job-list').data('jobs', jobs);
        const list = jobs.map((job, i) => `
            <div class="border p-3 rounded-lg cursor-pointer hover:bg-gray-100" data-index="${i}">
              <p class="font-bold">${job.title}</p>
              <p class="text-sm text-gray-600">${job.company}</p>
              <a href="${job.url}" target="_blank" class="text-blue-500 text-sm underline">查看職缺</a>
            </div>
        `).join('');
        $('#job-list').html(list);
        console.info(`成功顯示 ${jobs.length} 個職缺。`);
    } catch (err) {
        console.error("職缺搜尋失敗：", err);
        $('#job-list').html("<p class='text-red-500'>搜尋錯誤，請稍後再試</p>");
    }
}

function handleSelectJob() {
    console.log("點擊了職缺列表項目。");
    const index = $(this).data('index');
    const jobs = $('#job-list').data('jobs');
    selectedJob = jobs[index];
    $('#selected-job').text(`✅ 已選擇職缺：${selectedJob.title} @ ${selectedJob.company}`);
    console.info(`已選擇職缺: ${selectedJob.title}，公司: ${selectedJob.company}。`);
}

async function handleStartInterview() {
    console.log("點擊了 '開始模擬面試' 按鈕。");
    if (!selectedJob) {
        alert("請先選擇一個職缺再開始面試");
        console.warn("未選擇職缺，無法開始面試。");
        return;
    }

    const selectedModel = $('#model-select').val();
    console.log(`[UI] 選擇的模型: ${selectedModel}`);

    $('#start-interview').prop('disabled', true).text("面試準備中...");
    $('#chat-box').html("<p class='text-blue-500'>⏳ 正在為您客製化面試問題，請稍候...</p>");
    console.log("開始請求麥克風和攝影機權限...");
    const mediaPermissionStartTime = performance.now();

    try {
        // Try to get both audio and video
        try {
            userMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            const webcamVideo = $('#webcam')[0];
            webcamVideo.srcObject = userMediaStream;
            $('#video-section').removeClass('hidden');
            console.log("成功獲取音訊和視訊串流。");
        } catch (videoErr) {
            console.warn("無法取得攝影機權限或沒有攝影機，嘗試純音訊模式：", videoErr);
            // If video fails, try to get only audio
            userMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            $('#video-section').addClass('hidden'); // Hide video section if only audio
            console.log("成功獲取純音訊串流。");
        }
        const mediaPermissionEndTime = performance.now();
        console.log(`獲取媒體權限耗時: ${(mediaPermissionEndTime - mediaPermissionStartTime).toFixed(2)} 毫秒。`);

        console.log("發送啟動面試請求到後端...");
        const apiStartTime = performance.now();
        const res = await api_startInterview({ job: selectedJob, job_description: selectedJob.description, model_name: selectedModel });
        const apiEndTime = performance.now();
        console.log(`啟動面試 API 請求完成，耗時: ${(apiEndTime - apiStartTime).toFixed(2)} 毫秒。`);
        console.log("接收到啟動面試回應:", res);
        
        currentSessionId = res.session_id;
        // totalQuestions = res.first_question.total_questions; // Removed as questions are dynamic
        // currentQuestionNumber = 1; // Removed as questions are dynamic

        appendToChat("🤖 AI 面試官", res.first_question.text);
        console.log(`播放 AI 面試官的第一個問題音訊: ${res.first_question.audio_url}`);
        playAudio(res.first_question.audio_url);
        updateInterviewProgress();

        $('#record-btn').show();
        $('#end-interview').show();
        $('#start-interview').text("面試進行中...");
        console.info(`面試會話 ${currentSessionId} 已成功啟動。`);

    } catch (err) {
        console.error("啟動面試失敗或無法取得麥克風權限：", err);
        alert("啟動面試失敗或無法取得麥克風權限，請檢查瀏覽器設定並允許權限。");
        $('#chat-box').html("<p class='text-red-500'>❌ 面試啟動失敗，請檢查後端服務或網路連線。</p>");
        $('#start-interview').prop('disabled', false).text("開始模擬面試");
        // Clean up stream if it was partially obtained
        if (userMediaStream) {
            userMediaStream.getTracks().forEach(track => track.stop());
            userMediaStream = null;
        }
        $('#video-section').addClass('hidden');
    }
}

function toggleRecording() {
    console.log("點擊了 '錄音' 按鈕。當前錄音狀態: ", mediaRecorder ? mediaRecorder.state : "未初始化");
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log("MediaRecorder 正在錄音，停止錄音。");
        mediaRecorder.stop();
    } else {
        console.log("MediaRecorder 未錄音，開始錄音。");
        startRecording();
    }
}

async function handleEndInterview() {
    console.log("點擊了 '結束面試' 按鈕。");
    if (!currentSessionId) {
        console.warn("無效的會話ID，無法結束面試。");
        return;
    }

    console.log("手動結束面試。會話ID: ", currentSessionId);
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log("停止錄音。");
        mediaRecorder.stop();
    }

    try {
        console.log(`發送結束面試請求到後端，會話ID: ${currentSessionId}。`);
        const startTime = performance.now();
        await api_endInterview(currentSessionId);
        const endTime = performance.now();
        console.log(`結束面試 API 請求完成，耗時: ${(endTime - startTime).toFixed(2)} 毫秒。`);
        alert("面試已手動結束。");
    } catch (err) {
        console.error("結束面試失敗：", err);
    } finally {
        resetUIForNewInterview();
        console.info("面試結束後，UI 已重置。");
    }
}

function handleRestartInterview() {
    console.log("點擊了 '重新開始面試' 按鈕。");
    $('#report-section').addClass('hidden');
    $('#report-content').empty();
    $('#restart-interview').hide();
    resetUIForNewInterview();
    console.info("面試已重置，準備開始新的面試。");
}

// --- Media & UI Functions ---

async function startRecording() {
    console.log("[錄音] 呼叫 startRecording 函數。");
    
    // --- Update button state immediately ---
    $('#record-btn').text("結束說話").removeClass("bg-purple-600").addClass("bg-red-600");
    $('#record-btn').prop('disabled', true); // Temporarily disable to prevent double click

    try {
        console.log("[錄音] 嘗試獲取新的音訊串流用於錄音。");
        audioStreamForRecording = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("[錄音] 成功獲取音訊串流。串流狀態:", audioStreamForRecording.active);
        console.log("[錄音] 音訊軌道數量:", audioStreamForRecording.getAudioTracks().length);

        const candidateMimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg',
            'audio/wav'
        ];

        let successfullyStarted = false;
        let lastError = null;
        let selectedMimeType = null;

        for (const type of candidateMimeTypes) {
            console.log(`[錄音] 嘗試使用 MIME 類型: ${type}`);
            if (!MediaRecorder.isTypeSupported(type)) {
                console.warn(`[錄音] MIME 類型 ${type} 不受此瀏覽器支援。`);
                continue; // Skip to the next type if not supported
            }

            try {
                mediaRecorder = new MediaRecorder(audioStreamForRecording, { mimeType: type });
                audioChunks = []; // Clear previous chunks
                mediaRecorder.ondataavailable = event => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                        console.log(`[錄音] 接收到音訊數據塊，大小: ${event.data.size} 字節。`);
                    }
                };
                mediaRecorder.onstop = handleRecordingStop;
                mediaRecorder.start();
                console.log(`[錄音] MediaRecorder 成功啟動，使用 MIME 類型: ${type}`);
                successfullyStarted = true;
                selectedMimeType = type;
                break; // Break the loop if successfully started
            } catch (e) {
                console.error(`[錄音] 啟動 MediaRecorder 失敗，MIME 類型 ${type}:`, e);
                lastError = e; // Store the last error
                // Continue to the next MIME type if start() fails
            }
        }

        if (successfullyStarted) {
            $('#record-btn').prop('disabled', false); // Re-enable button after successful start
            console.info("[錄音] 錄音已開始。");
        } else {
            // If no MIME type worked
            console.error("[錄音] 沒有支援的音訊 MIME 類型可以啟動 MediaRecorder。");
            alert(`無法啟動錄音。請檢查麥克風設定或嘗試其他瀏覽器。最後的錯誤：${lastError ? lastError.message : '未知錯誤'}`);
            // Revert button state on error
            $('#record-btn').text("開始說話").removeClass("bg-red-600").addClass("bg-purple-600").prop('disabled', false);
            // Stop the newly acquired audio stream if recording failed
            if (audioStreamForRecording) {
                audioStreamForRecording.getTracks().forEach(track => track.stop());
                audioStreamForRecording = null;
                console.warn("[錄音] 錄音失敗，已停止音訊串流。");
            }
        }
    } catch (err) {
        console.error("[錄音] 獲取音訊串流失敗:", err);
        alert(`無法取得麥克風權限：${err.message}。請檢查瀏覽器設定並允許權限。`);
        // Revert button state on error
        $('#record-btn').text("開始說話").removeClass("bg-red-600").addClass("bg-purple-600").prop('disabled', false);
    }
}

async function handleRecordingStop() {
    console.log("[錄音] 錄音已停止，開始處理音訊和圖像數據。");
    $('#record-btn').text("處理中...").prop('disabled', true);
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log(`[錄音] 音訊 Blob 已建立，大小: ${audioBlob.size} 字節。`);

    let imageDataURL = ""; // Initialize with empty string
    const webcamVideo = $('#webcam')[0];

    // Only capture image if video stream is active and has dimensions
    console.log("攝影機視訊元素尺寸 (捕獲前):", webcamVideo.videoWidth, webcamVideo.videoHeight);
    if (userMediaStream && userMediaStream.getVideoTracks().length > 0 && webcamVideo.videoWidth > 0 && webcamVideo.videoHeight > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = webcamVideo.videoWidth;
        canvas.height = webcamVideo.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);
        imageDataURL = canvas.toDataURL('image/jpeg').split(',')[1]; // Get JPEG data URL and remove prefix
        console.log("捕獲的 imageDataURL 長度:", imageDataURL.length);
    } else {
        console.log("跳過圖像捕獲：userMediaStream 啟用:", !!userMediaStream, "視訊軌道數量:", userMediaStream ? userMediaStream.getVideoTracks().length : 0, "攝影機尺寸:", webcamVideo.videoWidth, webcamVideo.videoHeight);
    }

    // Stop the audio stream used for recording
    if (audioStreamForRecording) {
        audioStreamForRecording.getTracks().forEach(track => track.stop());
        audioStreamForRecording = null;
        console.log("[錄音] 已停止用於錄音的音訊串流。");
    }

    try {
        console.log("[API] 準備發送 FormData 到後端。");
        const formData = new FormData();
        formData.append('session_id', currentSessionId);
        formData.append('audio_file', audioBlob, 'user_answer.webm');
        formData.append('image_data', imageDataURL); // Append image data (can be empty)

        const res = await $.ajax({
            url: `${BACKEND_BASE_URL}/submit_answer_and_get_next_question`,
            method: "POST",
            data: formData,
            processData: false,
            contentType: false
        });
        console.log("[API] 收到後端回應:", res);
        
        // Display user's transcribed text (if backend provides it)
        if (res.user_text) {
             appendToChat("🗣️ 你", res.user_text);
             console.log(`[聊天] 顯示使用者轉錄文本: ${res.user_text}`);
        }

        if (res.interview_ended) {
            console.log("[面試] 面試已結束，開始生成報告。");
            appendToChat("🤖 AI 面試官", res.text);
            playAudio(res.audio_url);
            $('#chat-box').append("<p class='text-green-500'>面試結束，正在生成報告...</p>");
            $('#record-btn').hide();
            $('#end-interview').hide();
            const report = await api_getReport(currentSessionId);
            displayReport(report);
            // Interview ended, so clean up stream
            if (userMediaStream) {
                userMediaStream.getTracks().forEach(track => track.stop());
                userMediaStream = null;
                console.log("[媒體] 面試結束，已停止所有媒體串流。");
            }
            $('#video-section').addClass('hidden');
        } else {
            console.log("[面試] 獲取下一個問題。");
            // Handle next question
            // currentQuestionNumber++; // Removed as questions are dynamic
            // updateInterviewProgress(); // Removed as questions are dynamic
            appendToChat("🤖 AI 面試官", res.text);
            playAudio(res.audio_url);
        }
    } catch (err) {
        console.error("提交答案失敗:", err);
        alert("提交答案失敗，請再試一次。");
    } finally {
        $('#record-btn').text("開始說話").removeClass("bg-red-600").addClass("bg-purple-600").prop('disabled', false);
        console.log("[錄音] 錄音按鈕狀態已重置。");
    }
}

function appendToChat(speaker, message) {
    $('#chat-box').append(`
        <div class="my-2">
          <span class="font-semibold">${speaker}：</span>
          <span>${message}</span>
        </div>
    `).scrollTop($('#chat-box')[0].scrollHeight);
}

function playAudio(audioUrl) {
    console.log(`[音訊] 嘗試播放音訊: ${audioUrl}`);
    const ttsAudio = $('#tts-audio')[0];
    ttsAudio.src = audioUrl;
    ttsAudio.load();
    ttsAudio.play().then(() => {
        console.log("[音訊] 音訊播放成功。");
    }).catch(error => console.error("[音訊] 音訊播放失敗:", error));
}

function displayReport(report) {
    console.log("[報告] 顯示面試報告。");
    if (report.error) {
        $('#report-content').html(`<p class='text-red-500'>報告生成失敗: ${report.error}</p>`);
        console.error(`[報告] 報告生成失敗: ${report.error}`);
    } else {
        let reportHtml = `
            <h3 class="text-lg font-bold mb-2">綜合評分：${report.overall_score.toFixed(2)} / 5</h3>
            <p class="mb-4">是否錄取：<span class="font-bold ${report.hired ? 'text-green-600' : 'text-red-600'}">${report.hired ? '建議錄取' : '不建議錄取'}</span></p>
            <h4 class="font-semibold mb-2">各項能力評分：</h4>
            <ul class="list-disc list-inside">
        `;
        for (const dim in report.dimension_scores) {
            reportHtml += `<li>${dim}：${report.dimension_scores[dim].toFixed(2)} / 5</li>`;
        }
        reportHtml += `</ul>`;
        // Display conversation history if available
        if(report.conversation_history) {
            reportHtml += `<h4 class="font-semibold mt-4 mb-2">面試紀錄：</h4><div class="conversation-history border p-2 h-48" style="height: 12rem; overflow-y: auto !important;">`;
            report.conversation_history.forEach(msg => {
                const speaker = msg.role === 'user' ? '你' : 'AI';
                const text = msg.parts[0].text;
                reportHtml += `<p><strong>${speaker}:</strong> ${text}</p>`;
            });
            reportHtml += `</div>`;
        }
        $('#report-content').html(reportHtml);
        console.info("[報告] 面試報告內容已成功渲染。");
    }
    $('#report-section').removeClass('hidden');
    $('#restart-interview').show();
    console.log("[UI] 報告區塊已顯示，重新開始按鈕已顯示。");
}

function updateInterviewProgress() {
    console.log("[UI] 面試進度更新 (已移除問題計數顯示)。");
    $('#interview-progress').text(""); // Clear any previous progress text
}

function resetUIForNewInterview() {
    console.log("[UI] 重置使用者介面以開始新的面試。");
    $('#chat-box').empty();
    $('#selected-job').text("");
    $('#start-interview').prop('disabled', false).text("開始模擬面試");
    $('#record-btn').hide();
    $('#end-interview').hide();
    selectedJob = null;
    currentSessionId = null;
    currentQuestionNumber = 0; // Reset for consistency, though not used for display
    totalQuestions = 0; // Reset for consistency, though not used for display
    updateInterviewProgress();

    // Stop all tracks and clear the stream when resetting UI
    if (userMediaStream) {
        userMediaStream.getTracks().forEach(track => track.stop());
        userMediaStream = null;
        console.log("[媒體] 已停止使用者媒體串流 (攝影機/麥克風)。");
    }
    if (audioStreamForRecording) {
        audioStreamForRecording.getTracks().forEach(track => track.stop());
        audioStreamForRecording = null;
        console.log("[媒體] 已停止錄音專用音訊串流。");
    }
    $('#video-section').addClass('hidden');
    console.info("[UI] 使用者介面重置完成。");
}