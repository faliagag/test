const { createFFmpeg, fetchFile } = FFmpeg;

const ffmpeg = createFFmpeg({
    corePath: chrome.runtime.getURL("js/lib/ffmpeg-core.js"),
    log: false,
    mainName: 'main'
});

class ConcurrencyController {
    constructor() {
        this.taskQueue = [];
        this.executingTasks = new Set();
        this._concurrencyLimit = 3; // 默认并发数
    }

    set concurrencyLimit(newLimit) {
        this._concurrencyLimit = newLimit;
        this.checkQueue();
    }

    get concurrencyLimit() {
        return this._concurrencyLimit;
    }

    async addTask(task) {
        // 创建一个外部可控制的Promise
        let resolve, reject;
        const taskPromise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const taskWithPromises = () => task().then(resolve).catch(reject);

        if (this.executingTasks.size < this._concurrencyLimit) {
            this.runTask(taskWithPromises);
        } else {
            this.taskQueue.push(taskWithPromises);
        }

        return taskPromise;
    }

    async runTask(taskWithPromises) {
        const executingTask = taskWithPromises().then(() => {
            this.executingTasks.delete(executingTask);
            this.checkQueue();
        }).catch(() => {
            this.executingTasks.delete(executingTask);
            this.checkQueue();
        });
        this.executingTasks.add(executingTask);
    }

    checkQueue() {
        while (this.executingTasks.size < this._concurrencyLimit && this.taskQueue.length > 0) {
            this.runTask(this.taskQueue.shift());
        }
    }
}

const speedController = new ConcurrencyController();

const fetchBuffer = async (url, options, retryCount = 0, onFetched) => {
    // (3次重试)
    let res_buffer = new ArrayBuffer();
    const { maxRetries = 3 } = options;
    try {
        const response = await fetch(url);
        const resBuffer =  await response.arrayBuffer()
        onFetched && onFetched(resBuffer);
        return resBuffer
    } catch (error) {
        // 如果重试次数没有超过，那么重新调用
        if (retryCount < maxRetries) {
            return fetchBuffer(url, options, retryCount + 1, onFetched);
        }
        return res_buffer
    }
}

async function fetchBuffers(urls, onFetched) {
    const tasks = urls.map(url => async () => await fetchBuffer(url, { maxRetries: 3 }, 0, onFetched));
    const promises = tasks.map(task => new Promise((resolve, reject) => {
        speedController.addTask(() => task().then(resolve).catch(reject));
    }));
    return Promise.all(promises);
}

function updateProgress(number) {
    document.getElementById("child").style.width = number + '%'
    document.getElementById("span_progress").innerText = Math.ceil(number) + '%'
}

// 文件名称非法字符去除
function sanitize(input, replacement) {
    var illegalRe = /[\/\?<>\\:\*\|"]/g;
    var controlRe = /[\x00-\x1f\x80-\x9f]/g;
    var reservedRe = /^\.+$/;
    var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
    var windowsTrailingRe = /[\. ]+$/;
    var output = input
        .replaceAll("undefined", "")
        .replace(illegalRe, replacement)
        .replace(controlRe, replacement)
        .replace(reservedRe, replacement)
        .replace(windowsReservedRe, replacement)
        .replace(windowsTrailingRe, replacement);
    if (input !== output) {
        // console.log('  sanitize [' + input + '] to [' + output + ']');
    }
    return output;
}

async function writeBuffersToFile(buffers, filename) {
    const combinedBuffer = new Uint8Array(buffers.reduce((total, buffer) => total + buffer.byteLength, 0));
    let offset = 0;
    for (let buffer of buffers) {
        combinedBuffer.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    ffmpeg.FS('writeFile', filename, combinedBuffer);
}

// 解析m3u8
function parse_m3u8(base_url, m3u8_res) {
    var part = []
    var lines = m3u8_res.split('\n');
    let base_url_split;
    let flag = 0
    if (m3u8_res.indexOf("chop") !== -1) {
        flag = 1
        base_url_split = base_url.split("playlist")[0]
    } else {
        if (base_url.indexOf("video/both") !== -1) {
            base_url_split = base_url.split("video/both")[0].slice(0, -1)
        } else if (m3u8_res.indexOf("/avf") !== -1) {
            base_url_split = base_url.split("playlist")[0]
        } else {
            base_url_split = base_url.split("sep")[0].slice(0, -1)
        }
    }

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.startsWith('#EXT-X-MAP')) {
            if (flag) {
                part.push(base_url_split + line.split("URI=")[1].replaceAll('"', ''))
            } else {
                let line_split = line.split("..")
                part.push(base_url_split + line_split[line_split.length - 1].replaceAll('"', ''))
            }
        } else if (line.indexOf("mp4") !== - 1 || line.indexOf("m4s") !== -1 || line.indexOf("ts") !== -1) {
            if (flag) {
                part.push(base_url_split + line)
            } else {
                let line_split = line.split("..")
                part.push(base_url_split + line_split[line_split.length - 1])
            }
        }
    }
    return part
}

// 判断需要分成几个视频文件下载
function gen_file_list(part_len, size) {
    if (size <= 1.4) {
        return {
            "1": [1, part_len]
        }
    } else {
        let res = {}
        let list_len = Math.floor(size / 1.4) + 1
        let len_of_sublist = Math.floor(1.4 / size * part_len)
        for (let i = 1; i <= list_len; i++) {
            if (i * len_of_sublist < part_len) {
                res[String(i)] = [(i - 1) * len_of_sublist  + 1, i * len_of_sublist + 1]
            } else {
                res[String(i)] = [(i - 1) * len_of_sublist  + 1, part_len]
            }
        }
        return res
    }
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.action === "merge-video") {
        try {
            let response = await fetch("https://vimego.io/ffmpeg/vimeo-config/", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(msg.config_body)
            });

            let res_json = JSON.parse(await response.json());
            let video_url = res_json.video_url;
            let audio_url = res_json.audio_url;
            let video_size = res_json.size;

            let resp = await fetch(video_url);
            let text = await resp.text();
            let videoUrls = parse_m3u8(video_url, text);

            let audioUrls;
            if (audio_url) {
                let resp = await fetch(audio_url);
                let text = await resp.text();
                audioUrls = parse_m3u8(audio_url, text);
            } else {
                audioUrls = [];
            }
            const fileList = gen_file_list(videoUrls.length, video_size)

            let totalParts = videoUrls.length + audioUrls.length
            document.getElementById("waiting").style.display = "none"
            document.getElementById("down_show").style.display = "flex"
            document.getElementById("video_title").innerText = sanitize(msg.config_body.title)
            document.getElementById("video_cover").src = msg.config_body.cover

            let processedParts= 0
            let data

            const onFetched = () => {
                processedParts++;
                updateProgress((processedParts / totalParts * 99).toFixed(1))
            };

            // video启动片段
            let videoInitBuffer = await fetchBuffer(videoUrls[0], {maxRetries: 3})
            if (!ffmpeg.isLoaded()) {
                await ffmpeg.load();
            }
            for (let [index, fileRange] of Object.entries(fileList)) {
                if (!ffmpeg.isLoaded()) {
                    await ffmpeg.load();
                }
                const videoBuffers = [videoInitBuffer, ...await fetchBuffers(videoUrls.slice(fileRange[0], fileRange[1]), onFetched)]
                await writeBuffersToFile(videoBuffers, 'video_merge.mp4');
                if (audioUrls.length === 0) {
                    data = ffmpeg.FS('readFile', 'video_merge.mp4');
                } else {
                    // audio启动片段
                    let audioInitBuffer = await fetchBuffer(audioUrls[0], {maxRetries: 3})
                    const audioBuffers = [audioInitBuffer, ...await fetchBuffers(audioUrls.slice(fileRange[0], fileRange[1]), onFetched)]
                    await writeBuffersToFile(audioBuffers, 'audio_merge.mp4');
                    await ffmpeg.run('-i', 'video_merge.mp4', '-i', 'audio_merge.mp4', '-c:v', 'copy', '-c:a', 'aac', '-strict', 'experimental', 'merge.mp4');
                    data = ffmpeg.FS('readFile', 'merge.mp4');
                }
                // 下载
                var fileBlob = new Blob([data.buffer],{type:"application/octet-stream;"});
                let link = document.createElement('a');
                link.href = window.URL.createObjectURL(fileBlob);
                link.download = sanitize(msg.config_body.title, "") + '.mp4';
                link.click()
                updateProgress(100)
            }
            await ffmpeg.exit()
        } catch (e) {
            await ffmpeg.exit()
        }
    }
})

var speedRadios = document.querySelectorAll('#speed-selector input[type=radio]');
speedRadios.forEach(function(radio) {
    radio.addEventListener('change', function() {
        if (this.checked) {
            speedController.concurrencyLimit = parseInt(this.value);
        }
    });
});
