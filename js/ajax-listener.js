//2025年3月5日处理
//单独处理带review路径无法注入configUrl的问题
const vimeoReviewRegex = /vimeo\.com\/.*\/review\//;
//监控消息发送
if (typeof XMLHttpRequest.prototype._origOpen === "undefined") {
  XMLHttpRequest.prototype._origOpen = XMLHttpRequest.prototype.open;
}
XMLHttpRequest.prototype.open = function () {
  this.addEventListener("load", function (e) {
    try {
      let responseText = JSON.parse(this.responseText);

      if (
        responseText.request &&
        responseText.request.files &&
        responseText.cdn_url &&
        responseText.cdn_url.indexOf("vimeo") != -1 &&
        !document.querySelector(".variant-v2")
      ) {
        const params = parseUrlParams(this.responseURL);

        var isTarget = false;
        if (params.referrer) {
          // console.log("含有referrer");
          isTarget = true;
        } else {
          // console.log("不含有referrer");
          if (
            this.responseURL.includes("ask_ai") ||
            this.responseURL.includes("access_gates")||vimeoReviewRegex.test(window.location.href)
          ) {
            isTarget = true;
            // console.log("含有ask_ai或access_gates");
          }
        }

        if (isTarget) {
          if (!document.querySelector(".vtConfigUrl")) {
            document.body.insertAdjacentHTML(
              "beforeend",
              `<div class="vtConfigUrl" url=${e.currentTarget.responseURL}></div>`
            );
          } else {
            document
              .querySelector(".vtConfigUrl")
              .setAttribute("url", `${e.currentTarget.responseURL}`);
            postMessage({
              type: "configUrl",
              url: e.currentTarget.responseURL,
            });
          }
        }
      }
      // if (responseText.clip_id && responseText.audio) {
      //   let baseUrl = new URL(this.responseURL)
      //   let relativeUrl = responseText.base_url + "range/avf/" + responseText.audio[0].segments[0].url
      //   relativeUrl = relativeUrl.replace('/range/avf/range/avf', '/range/avf')
      //   let finalUrl = new URL(relativeUrl, baseUrl)
      //   let finalAudioUrl = modifyLastRange(finalUrl.toString())
      //   if (!document.querySelector(".vtAudioUrl")) {
      //     document.body.insertAdjacentHTML(
      //         "beforeend",
      //         `<div class="vtAudioUrl" url=${finalAudioUrl}></div>`
      //     );
      //   } else {
      //     document.querySelector(".vtAudioUrl").setAttribute("url", `${finalAudioUrl}`)
      //   }
      // }
    } catch (e) {}
  });
  XMLHttpRequest.prototype._origOpen.apply(this, arguments);
};

function modifyLastRange(str) {
  const regex = /range=\d+-\d+$/;
  return str.replace(regex, "range=0-999999999999");
}

/**
 * 列举config url的参数，调试用
 * @param {*} url
 * @returns
 */
function parseUrlParams(url) {
  const params = {};
  const queryString = url.split("?")[1];
  if (queryString) {
    queryString.split("&").forEach((param) => {
      const [key, value] = param.split("=");
      params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    });
  }
  return params;
}
