
const LOG = (...a) => console.log('[YT→GPT]', ...a);

chrome.action.onClicked.addListener(() => chrome.tabs.query({active:true,currentWindow:true}, ([tab]) => {
  if (tab) {
    runForTab(tab);
  } else {
    LOG('no active tab');
  }
}));

async function runForTab(ytTab) {
  LOG('Starting for', ytTab.url);

  const pairs = await extractSegments(ytTab.id);
  if(!pairs.length) { 
    alert('Transcript not found'); 
    return; 
  }
  const transcript = condense(pairs);
  const prompt = `Summarize the following content in 5-10 bullet points with timestamp if it's transcript.\nTitle: ${ytTab.title}\nURL: ${ytTab.url}\nTranscript:\n${transcript}`;

  openAndPaste(prompt);
}

async function extractSegments(tabId) {
  const [{result}] = await chrome.scripting.executeScript({
    target: {tabId}, world: 'MAIN',
    func: () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const open = async () => {
        const b = [...document.querySelectorAll('button')].find(x => /transcript/i.test(x.innerText));
        if (b) {
          b.click(); 
          await sleep(800);
        }
        const t = [...document.querySelectorAll('tp-yt-paper-tab')].find(x => /transcript/i.test(x.textContent));
        if(t && !t.hasAttribute('selected')){
          t.click();
          await sleep(600);
        }
      };
      const collect = () => {
        return [...document.querySelectorAll('ytd-transcript-segment-renderer')].map( s => {
          const ts = (s.querySelector('.segment-timestamp,#timestamp') || {}).innerText || s.innerText.split('\n')[0];
          const txt = (s.querySelector('.segment-text,#segment-text') || {}).innerText || s.innerText.split('\n').slice(1).join(' ');
          return {ts:ts.trim(), text:txt.trim()};
        }).filter(p => p.ts && p.text);
      };

      return (async () =>{
        await open(); 
        await sleep(400); 
        return collect();})();
    }
  });
  return result;
}

function condense(pairs){
  const out = []; 
  let last = -30;
  const toSec = t => t.split(':').map(Number).reduce((a,v) => a*60 + v, 0);
  for (const {ts, text} of pairs) {
    const s = toSec(ts);
    if (s - last >= 30) {
      out.push(`(${ts}) ${text}`);
      last = s;
    } else if (out.length) {
      out[out.length - 1] += ' ' + text;
    }
  }
  return out.join('\n');
}

function openAndPaste(text) {
  LOG('opening ChatGPT');
  chrome.tabs.create({url:'https://chat.openai.com', active:true}, (tab) => {
    const id = tab.id;
    chrome.tabs.onUpdated.addListener(function l(i, info) {
      if (i !== id || info.status !== 'complete') {
        return;
      }
      chrome.tabs.onUpdated.removeListener(l);
      pasteToTab(id, text);
    });
  });
}

function pasteToTab(tabId, text){
  chrome.debugger.attach({tabId}, '1.3', () => {
    if (chrome.runtime.lastError) {
      LOG('attach error', chrome.runtime.lastError.message);
      return;
    }
    chrome.debugger.sendCommand({tabId},'Page.getFrameTree', {}, (tree) => {
      const frame = findFrame(tree);
      const params = frame ? {text, frameId:frame} : {text};
      chrome.debugger.sendCommand({tabId}, 'Input.insertText', params, () => {
        chrome.debugger.sendCommand({tabId}, 'Input.dispatchKeyEvent', Object.assign({
          type:'keyDown', 
          windowsVirtualKeyCode:13, 
          nativeVirtualKeyCode:13,
          code:'Enter',
          key:'Enter',
          unmodifiedText:'\n',
          text:'\n'
        }, frame ? {frameId:frame} : {}),
        () => {
            chrome.debugger.detach({tabId});
        });
      });
    });
  });
}

function findFrame(tree){
  const q = [tree.frameTree];
  while (q.length) {
    const n = q.shift();
    if (n.frame && (n.frame.url.startsWith('https://chat.openai.com') || n.frame.url.startsWith('https://chatgpt.com'))) {
      return n.frame.id;
    }
    (n.childFrames || []).forEach(c => q.push(c));
  }
  return null;
}
