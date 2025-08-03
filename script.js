const BACKEND_BASE_URL = "https://e255da7eb7aa.ngrok-free.app";


// --- Global State ---
let selectedJob = null;
let mediaRecorder = null;
let audioChunks = [];
let currentSessionId = null;
let currentQuestionNumber = 0;
let totalQuestions = 0;

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
    return await $.get(`${BACKEND_BASE_URL}/jobs?keyword=${encodeURIComponent(keyword)}`);
}

async function api_startInterview(jobData) {
    return await $.ajax({
        url: `${BACKEND_BASE_URL}/start_interview`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify(jobData)
    });
}

async function api_submitAnswer(sessionId, audioBlob) {
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('audio_file', audioBlob, 'user_answer.webm');

    return await $.ajax({
        url: `${BACKEND_BASE_URL}/submit_answer_and_get_next_question`,
        method: "POST",
        data: formData,
        processData: false,
        contentType: false
    });
}

async function api_getReport(sessionId) {
    return await $.get(`${BACKEND_BASE_URL}/get_interview_report?session_id=${sessionId}`);
}

async function api_endInterview(sessionId) {
    return await $.ajax({
        url: `${BACKEND_BASE_URL}/end_interview`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ session_id: sessionId })
    });
}

// --- Event Handlers ---

async function handleSearchJobs() {
    const keyword = $('#job-input').val().trim();
    if (!keyword) return alert("請輸入職缺名稱");

    $('#job-list').html("<p class='text-gray-500'>正在搜尋中...</p>");
    try {
        const res = await api_getJobs(keyword);
        const jobs = res.jobs;
        if (!jobs || jobs.length === 0) {
            $('#job-list').html("<p class='text-red-500'>查無職缺</p>");
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
    } catch (err) {
        console.error("職缺搜尋失敗：", err);
        $('#job-list').html("<p class='text-red-500'>搜尋錯誤，請稍後再試</p>");
    }
}

function handleSelectJob() {
    const index = $(this).data('index');
    const jobs = $('#job-list').data('jobs');
    selectedJob = jobs[index];
    $('#selected-job').text(`✅ 已選擇職缺：${selectedJob.title} @ ${selectedJob.company}`);
}

async function handleStartInterview() {
    if (!selectedJob) {
        return alert("請先選擇一個職缺再開始面試");
    }

    $('#start-interview').prop('disabled', true).text("面試準備中...");
    $('#chat-box').html("<p class='text-blue-500'>⏳ 正在為您客製化面試問題，請稍候...</p>");

    try {
        const res = await api_startInterview({ job: selectedJob, job_description: selectedJob.description });
        
        currentSessionId = res.session_id;
        totalQuestions = res.first_question.total_questions;
        currentQuestionNumber = 1;

        appendToChat("🤖 AI 面試官", res.first_question.text);
        playAudio(res.first_question.audio_url);
        updateInterviewProgress();

        $('#record-btn').show();
        $('#end-interview').show();
        $('#start-interview').text("面試進行中...");

    } catch (err) {
        console.error("啟動面試失敗：", err);
        $('#chat-box').html("<p class='text-red-500'>❌ 面試啟動失敗，請檢查後端服務或網路連線。</p>");
        $('#start-interview').prop('disabled', false).text("開始模擬面試");
    }
}

function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else {
        startRecording();
    }
}

async function handleEndInterview() {
    if (!currentSessionId) return;

    console.log("Ending interview manually.");
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }

    try {
        await api_endInterview(currentSessionId);
        alert("面試已手動結束。");
    } catch (err) {
        console.error("Error ending interview:", err);
    } finally {
        resetUIForNewInterview();
    }
}

function handleRestartInterview() {
    $('#report-section').addClass('hidden');
    $('#report-content').empty();
    $('#restart-interview').hide();
    resetUIForNewInterview();
}

// --- Media & UI Functions ---

function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
            // Display video stream
            const webcamVideo = $('#webcam')[0];
            webcamVideo.srcObject = stream;
            $('#video-section').removeClass('hidden');

            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = []; // Clear previous chunks
            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };
            mediaRecorder.onstop = handleRecordingStop;
            mediaRecorder.start();
            $('#record-btn').text("結束說話").removeClass("bg-purple-600").addClass("bg-red-600");
        })
        .catch(err => {
            console.error("無法取得麥克風或攝影機權限:", err);
            alert("無法取得麥克風或攝影機權限，請檢查瀏覽器設定。");
        });
}

async function handleRecordingStop() {
    $('#record-btn').text("處理中...").prop('disabled', true);
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

    // Capture a frame from the video stream
    const webcamVideo = $('#webcam')[0];
    const canvas = document.createElement('canvas');
    canvas.width = webcamVideo.videoWidth;
    canvas.height = webcamVideo.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);
    const imageDataURL = canvas.toDataURL('image/jpeg').split(',')[1]; // Get JPEG data URL and remove prefix

    // Stop all tracks to turn off camera/mic
    if (webcamVideo.srcObject) {
        webcamVideo.srcObject.getTracks().forEach(track => track.stop());
        webcamVideo.srcObject = null;
    }
    $('#video-section').addClass('hidden');

    try {
        const formData = new FormData();
        formData.append('session_id', currentSessionId);
        formData.append('audio_file', audioBlob, 'user_answer.webm');
        formData.append('image_data', imageDataURL); // Append image data

        const res = await $.ajax({
            url: `${BACKEND_BASE_URL}/submit_answer_and_get_next_question`,
            method: "POST",
            data: formData,
            processData: false,
            contentType: false
        });
        
        // Display user's transcribed text (if backend provides it)
        if (res.user_text) {
             appendToChat("🗣️ 你", res.user_text);
        }

        if (res.interview_ended) {
            // Handle end of interview
            appendToChat("🤖 AI 面試官", res.text);
            playAudio(res.audio_url);
            $('#chat-box').append("<p class='text-green-500'>面試結束，正在生成報告...</p>");
            $('#record-btn').hide();
            $('#end-interview').hide();
            const report = await api_getReport(currentSessionId);
            displayReport(report);
        } else {
            // Handle next question
            currentQuestionNumber++;
            updateInterviewProgress();
            appendToChat("🤖 AI 面試官", res.text);
            playAudio(res.audio_url);
        }
    } catch (err) {
        console.error("提交答案失敗:", err);
        alert("提交答案失敗，請再試一次。");
    } finally {
        $('#record-btn').text("開始說話").removeClass("bg-red-600").addClass("bg-purple-600").prop('disabled', false);
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
    const ttsAudio = $('#tts-audio')[0];
    ttsAudio.src = audioUrl;
    ttsAudio.load();
    ttsAudio.play().catch(error => console.error("Audio playback failed:", error));
}

function displayReport(report) {
    if (report.error) {
        $('#report-content').html(`<p class='text-red-500'>報告生成失敗: ${report.error}</p>`);
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
            reportHtml += `<h4 class="font-semibold mt-4 mb-2">面試紀錄：</h4><div class="conversation-history border p-2 h-48 overflow-y-auto">`;
            report.conversation_history.forEach(msg => {
                const speaker = msg.role === 'user' ? '你' : 'AI';
                const text = msg.parts[0].text;
                reportHtml += `<p><strong>${speaker}:</strong> ${text}</p>`;
            });
            reportHtml += `</div>`;
        }
        $('#report-content').html(reportHtml);
    }
    $('#report-section').removeClass('hidden');
    $('#restart-interview').show();
}

function updateInterviewProgress() {
    if (totalQuestions > 0 && currentQuestionNumber <= totalQuestions) {
        $('#interview-progress').text(`問題 ${currentQuestionNumber} / ${totalQuestions}`);
    } else {
        $('#interview-progress').text("");
    }
}

function resetUIForNewInterview() {
    $('#chat-box').empty();
    $('#selected-job').text("");
    $('#start-interview').prop('disabled', false).text("開始模擬面試");
    $('#record-btn').hide();
    $('#end-interview').hide();
    selectedJob = null;
    currentSessionId = null;
    currentQuestionNumber = 0;
    totalQuestions = 0;
    updateInterviewProgress();
}
