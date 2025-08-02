const BACKEND_BASE_URL = "https://bc3a48b9b3cc.ngrok-free.app";
const BACKEND_WS_URL = "wss://bc3a48b9b3cc.ngrok-free.app";

let selectedJob = null;
let streamMode = "none";
let ws = null; // WebSocket instance
let mediaRecorder = null;
let audioChunks = [];
let sessionId = null; // New: To store the session ID
let interviewEndedByBackend = false; // New: Flag to indicate if interview ended by backend signal

$(document).ready(function () {
  $('#search-btn').on('click', async function () {
    const keyword = $('#job-input').val().trim();
    if (!keyword) return alert("請輸入職缺名稱");

    $('#job-list').html("<p class='text-gray-500'>正在搜尋中...</p>");

    try {
      const res = await $.get(`${BACKEND_BASE_URL}/jobs?keyword=${encodeURIComponent(keyword)}`);
      const jobs = res.jobs;
      if (!jobs || jobs.length === 0) {
        $('#job-list').html("<p class='text-red-500'>查無職缺</p>");
        return;
      }

      const list = jobs.map((job, i) => `
        <div class="border p-3 rounded-lg cursor-pointer hover:bg-gray-100" data-index="${i}">
          <p class="font-bold">${job.title}</p>
          <p class="text-sm text-gray-600">${job.company}</p>
          <a href="${job.url}" target="_blank" class="text-blue-500 text-sm underline">查看職缺</a>
        </div>
      `).join('');

      $('#job-list').html(list);

      $('#job-list div').on('click', function () {
        const index = $(this).data('index');
        selectedJob = jobs[index];
        $('#selected-job').text(`✅ 已選擇職缺：${selectedJob.title} @ ${selectedJob.company}`);
        console.log("Selected Job Description:", selectedJob.description); // Add this line to verify
      });

    } catch (err) {
      console.error("職缺搜尋失敗：", err);
      $('#job-list').html("<p class='text-red-500'>搜尋錯誤，請稍後再試</p>");
    }
  });

  $('#start-interview').on('click', async function () {
    if (!selectedJob) {
      alert("請先選擇一個職缺再開始面試");
      return;
    }

    // Disable the start button to prevent multiple clicks
    $('#start-interview').prop('disabled', true).text("面試進行中...");

    $('#chat-box').html("<p class='text-blue-500'>⏳ 等待 AI 面試官回覆...</p>");
    // $('#report-section').addClass('hidden'); // Hide report section on new interview - Removed as per user request

    // Initial POST request for the first question
    try {
      const res = await $.ajax({
        url: `${BACKEND_BASE_URL}/start_interview`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ job: selectedJob, job_description: selectedJob.description })
      });

      if (res && res.text) {
        appendToChat("🤖 AI 面試官", res.text);
        sessionId = res.session_id; // Store the session ID
      }

      if (res && res.audio_url) {
        const ttsAudio = $('#tts-audio')[0];
        ttsAudio.src = res.audio_url;
        ttsAudio.load();
        ttsAudio.play().catch(error => {
          console.error("Initial audio playback failed:", error);
          console.log("Audio networkState:", ttsAudio.networkState);
          console.log("Audio readyState:", ttsAudio.readyState);
        });
      }

      // Establish WebSocket connection after getting session ID
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamMode = "視訊 + 語音";
        $('#mode-label').text(`目前模式：${streamMode}`);
        $('#video-section').removeClass('hidden');
        document.getElementById('webcam').srcObject = stream;

        // Initialize WebSocket with session ID
        ws = new WebSocket(`${BACKEND_WS_URL}/ws?session_id=${sessionId}`);

        ws.onopen = () => {
          console.log("WebSocket connected");
          $('#record-btn').show(); // Show the record button
          $('#end-interview').show(); // Show the end interview button
        };

        ws.onmessage = (event) => {
            console.log("Raw WebSocket message (audio-only):", event.data);
            const data = JSON.parse(event.data);
            console.log("Parsed WebSocket data (audio-only):", data);
            if (data.text) {
              if (data.speaker === "你") {
                appendToChat("🗣️ 你", data.text);
              } else {
                appendToChat("🤖 AI 面試官", data.text);
              }
            }
            if (data.audio_url) {
              const ttsAudio = $('#tts-audio')[0];
              ttsAudio.src = data.audio_url;
              ttsAudio.load();
              ttsAudio.play().catch(error => {
                console.error("WebSocket audio playback failed:", error);
                console.log("Audio networkState:", ttsAudio.networkState);
                console.log("Audio readyState:", ttsAudio.readyState);
              });
            }
            if (data.interview_ended) {
              console.log("Interview ended signal received from backend (audio-only).");
              interviewEndedByBackend = true; // Set the flag immediately
              $('#record-btn').hide();
              $('#end-interview').prop('disabled', true); // Disable the end interview button
              $('#chat-box').append("<p class='text-green-500'>面試結束，正在生成報告...</p>");
              console.log(`Attempting to get interview report for session ID: ${sessionId} (audio-only)`);
              // Call backend to get report
              $.get(`${BACKEND_BASE_URL}/get_interview_report?session_id=${sessionId}`)
                .done(function(report) {
                  console.log("Successfully received interview report (audio-only):", report);
                  displayReport(report);
                })
                .fail(function(err) {
                  console.error("Failed to get interview report (audio-only):", err);
                  $('#report-content').html("<p class='text-red-500'>報告生成失敗。</p>");
                  $('#report-section').removeClass('hidden');
                  $('#restart-interview').show();
                });
            }
          };

        ws.onclose = () => {
          console.log("WebSocket disconnected. interviewEndedByBackend:", interviewEndedByBackend);
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          $('#start-interview').prop('disabled', false).text("開始模擬面試");
          $('#record-btn').hide(); // Hide the record button
          $('#end-interview').hide(); // Hide the end interview button
          if (!interviewEndedByBackend) { // Only reset UI if not ended by backend
            $('#chat-box').html("<p class='text-gray-500'>面試已結束。</p>");
            $('#selected-job').text("");
            selectedJob = null;
            sessionId = null;
          }
          interviewEndedByBackend = false; // Reset the flag
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          alert("WebSocket 連線錯誤，請檢查後端服務");
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          $('#start-interview').prop('disabled', false).text("開始模擬面試");
          $('#record-btn').hide(); // Hide the record button
          $('#end-interview').hide(); // Hide the end interview button
        };

      } catch (err) {
        console.warn("啟動視訊失敗，改用語音模式", err);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamMode = "語音僅";
          $('#mode-label').text(`目前模式：${streamMode}`);

          // Initialize WebSocket for audio-only with session ID
          ws = new WebSocket(`${BACKEND_WS_URL}/ws?session_id=${sessionId}`);

          ws.onopen = () => {
            console.log("WebSocket connected (audio-only)");
            $('#record-btn').show(); // Show the record button
            $('#end-interview').show(); // Show the end interview button
          };

          ws.onmessage = (event) => {
            console.log("Raw WebSocket message (audio-only):", event.data);
            const data = JSON.parse(event.data);
            console.log("Parsed WebSocket data (audio-only):", data);
            if (data.text) {
              if (data.speaker === "你") {
                appendToChat("🗣️ 你", data.text);
              } else {
                appendToChat("🤖 AI 面試官", data.text);
              }
            }
            if (data.audio_url) {
              const ttsAudio = $('#tts-audio')[0];
              ttsAudio.src = data.audio_url;
              ttsAudio.load();
              ttsAudio.play().catch(error => {
                console.error("WebSocket audio playback failed:", error);
                console.log("Audio networkState:", ttsAudio.networkState);
                console.log("Audio readyState:", ttsAudio.readyState);
              });
            }
            if (data.interview_ended) {
              console.log("Interview ended signal received from backend (audio-only).");
              interviewEndedByBackend = true; // Set the flag immediately
              $('#record-btn').hide();
              $('#end-interview').prop('disabled', true); // Disable the end interview button
              $('#chat-box').append("<p class='text-green-500'>面試結束，正在生成報告...</p>");
              console.log(`Attempting to get interview report for session ID: ${sessionId} (audio-only)`);
              // Call backend to get report
              $.get(`${BACKEND_BASE_URL}/get_interview_report?session_id=${sessionId}`)
                .done(function(report) {
                  console.log("Successfully received interview report (audio-only):", report);
                  displayReport(report);
                })
                .fail(function(err) {
                  console.error("Failed to get interview report (audio-only):", err);
                  $('#report-content').html("<p class='text-red-500'>報告生成失敗。</p>");
                  $('#report-section').removeClass('hidden');
                  $('#restart-interview').show();
                });
            }
          };

          ws.onclose = () => {
            console.log("WebSocket disconnected (audio-only)");
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            $('#start-interview').prop('disabled', false).text("開始模擬面試");
            $('#record-btn').hide(); // Hide the record button
            $('#end-interview').hide(); // Hide the end interview button
            if (!interviewEndedByBackend) { // Only reset UI if not ended by backend
              $('#chat-box').html("<p class='text-gray-500'>面試已結束。</p>");
              $('#selected-job').text("");
              selectedJob = null;
              sessionId = null;
            }
            interviewEndedByBackend = false; // Reset the flag
          };

          ws.onerror = (error) => {
            console.error("WebSocket error (audio-only):", error);
          alert("WebSocket 連線錯誤，請檢查後端服務");
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            $('#start-interview').prop('disabled', false).text("開始模擬面試");
            $('#record-btn').hide(); // Hide the record button
            $('#end-interview').hide(); // Hide the end interview button
          };

        } catch (err2) {
          alert("❌ 無法取得麥克風或攝影機權限");
          $('#start-interview').prop('disabled', false).text("開始模擬面試");
          return;
        }
      }

    } catch (err) {
      console.error("啟動面試失敗：", err);
      $('#chat-box').html("<p class='text-red-500'>❌ 面試啟動失敗</p>");
      $('#start-interview').prop('disabled', false).text("開始模擬面試");
    }
  });

  // Record button logic
  $('#record-btn').on('click', async function () {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert("WebSocket 未連線，請先開始面試。");
      return;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      // Stop recording
      mediaRecorder.stop();
      $(this).text("開始說話").removeClass("bg-red-600").addClass("bg-purple-600");
      console.log("Recording stopped.");
    } else {
      // Start recording
      audioChunks = []; // Clear previous chunks
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = (event) => {
        console.log("ondataavailable event.data size:", event.data.size, "bytes");
        audioChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        console.log("mediaRecorder onstop triggered.");
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log("Audio Blob size (onstop):", audioBlob.size, "bytes");
        if (audioBlob.size > 0) {
          ws.send(audioBlob);
          appendToChat("🗣️ 你", "正在處理您的語音..."); // Placeholder for user's speech
        }
        audioChunks = []; // Clear chunks
      };
      mediaRecorder.start(); // Start recording without time slicing
      $(this).text("結束說話").removeClass("bg-purple-600").addClass("bg-red-600");
      console.log("Recording started.");
    }
  });

  // End interview button logic
  $('#end-interview').on('click', async function () {
    if (interviewEndedByBackend) {
      // If interview was ended by backend, just reset UI, report fetching is handled by onmessage
      console.log("Manual end button clicked, but interview already ended by backend. Resetting UI (excluding session data). Keep chat-box content.");
      // Only reset UI elements that don't interfere with report fetching
      $('#start-interview').prop('disabled', false).text("開始模擬面試");
      $('#record-btn').hide();
      $('#end-interview').hide();
      // Do NOT clear chat-box here, it should show "正在生成報告..."
      // Do NOT clear selectedJob, sessionId here if interviewEndedByBackend is true
    } else {
      // If interview was not ended by backend, this is a manual end
      console.log("Manual end button clicked. Sending end_interview signal to backend.");
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "end_interview", session_id: sessionId })); // Send a signal to backend
        ws.close(); // Close WebSocket connection
      }
      // Reset all UI elements including session data for a true manual end
      $('#start-interview').prop('disabled', false).text("開始模擬面試");
      $('#record-btn').hide();
      $('#end-interview').hide();
      $('#chat-box').html("<p class='text-gray-500'>面試已結束。</p>");
      $('#selected-job').text("");
      selectedJob = null;
      sessionId = null;
    }
    interviewEndedByBackend = false; // Reset the flag for the next interview
  });

  // Restart interview button logic
  $('#restart-interview').on('click', function() {
    $('#report-section').addClass('hidden');
    $('#report-content').empty();
    $('#restart-interview').hide();
    $('#chat-box').empty();
    $('#start-interview').prop('disabled', false).text("開始模擬面試");
    $('#selected-job').text("");
    selectedJob = null;
    sessionId = null;
  });
});

function appendToChat(speaker, message) {
  $('#chat-box').append(`
    <div>
      <span class="font-semibold">${speaker}：</span>
      <span>${message}</span>
    </div>
  `).scrollTop($('#chat-box')[0].scrollHeight);
}

function displayReport(report) {
  console.log("displayReport function called with report:", report);
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
  $('#report-content').html(reportHtml);
  $('#report-section').removeClass('hidden');
  $('#restart-interview').show();
}
