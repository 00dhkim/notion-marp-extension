
/* global chrome */
document.addEventListener("DOMContentLoaded", restore);

document.getElementById("save").addEventListener("click", save);

function restore() {
  chrome.storage.sync.get({ notionToken: "", openaiKey: "" }, (items) => {
    document.getElementById("notion").value = items.notionToken;
    document.getElementById("openai").value = items.openaiKey;
  });
}

function save() {
  const notionToken = document.getElementById("notion").value.trim();
  const openaiKey = document.getElementById("openai").value.trim();
  chrome.storage.sync.set({ notionToken, openaiKey }, () => {
    const s = document.getElementById("status");
    s.textContent = "Saved ✔";
    setTimeout(() => (s.textContent = ""), 1500);
  });
}
