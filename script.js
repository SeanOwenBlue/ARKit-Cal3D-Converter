let scene, camera, renderer, model, headBone, controls;
let csvData = [];
let shapeNames = [];
let isPlaying = false;
let startTime = 0;
let lastFrameIdx = -1;

// 1. Initialize 3D Scene
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    camera.position.set(0, 10, 40);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(5, 10, 7.5);
    scene.add(sunLight);

    window.addEventListener('resize', onWindowResize);
    animate();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// 2. Animation Loop
function animate() {
    requestAnimationFrame(animate);
    
    if (isPlaying && csvData.length > 0) {
        const fps = parseFloat(document.getElementById('fpsInput').value) || 60;
        const start = parseInt(document.getElementById('trimStart').value);
        const end = parseInt(document.getElementById('trimEnd').value);

        if (startTime === 0) startTime = performance.now();
        const elapsed = (performance.now() - startTime) / 1000;
        
        let frameIdx = start + Math.floor(elapsed * fps);

        if (frameIdx > end) {
            const isLooping = document.getElementById('loopToggle').checked;
            if (isLooping) {
                startTime = performance.now(); 
                frameIdx = start;
            } else {
                isPlaying = false; 
                frameIdx = end;    
            }
        }

        if (frameIdx !== lastFrameIdx) {
            applyFrameData(csvData[frameIdx]);
            updateTimeDisplay(frameIdx, fps);
            lastFrameIdx = frameIdx;
        }
    }
    
    if (controls) controls.update();
    renderer.render(scene, camera);
}

function applyFrameData(row) {
    if (!model || !row) return;
    
    model.traverse(child => {
        if (child.isMesh && child.morphTargetDictionary) {
            Object.entries(child.morphTargetDictionary).forEach(([name, idx]) => {
                const csvKey = name.charAt(0).toUpperCase() + name.slice(1);
                if (row[csvKey] !== undefined) {
                    child.morphTargetInfluences[idx] = parseFloat(row[csvKey]);
                }
            });
        }
    });

    if (headBone) {
        headBone.rotation.set(
            parseFloat(row.HeadPitch || 0),
            parseFloat(row.HeadYaw || 0),
            parseFloat(row.HeadRoll || 0)
        );
    }
}

// 3. FBX Loader Logic
function loadFBX(url, isDefault = false) {
    const loader = new THREE.FBXLoader();
    if (!isDefault) document.getElementById('loading-overlay').classList.remove('hidden');

    loader.load(url, (object) => {
        if (model) scene.remove(model);
        model = object;
        scene.add(model);
        
        const boneSelect = document.getElementById('boneSelect');
        boneSelect.innerHTML = ''; 

        let bones = [];
        model.traverse(child => {
            if (child.isBone) {
                bones.push(child);
                const option = document.createElement('option');
                option.value = child.name;
                option.text = child.name;
                boneSelect.appendChild(option);
            }
        });

        // --- PRIORITY SELECTION LOGIC ---
        // 1. Try to find an EXACT match for "Head" (case-insensitive)
        let target = bones.find(b => b.name.toLowerCase() === "head");

        // 2. If no exact match, find the first bone that contains "head"
        if (!target) {
            target = bones.find(b => b.name.toLowerCase().includes("head"));
        }

        // Apply the selection to the UI and the preview variable
        if (target) {
            headBone = target;
            boneSelect.value = target.name;
            showToast(`Auto-selected: ${target.name}`);
        }

        // Setup camera/view
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        camera.position.set(0, center.y, size.y * 2);
        controls.target.copy(center);

        document.getElementById('loading-overlay').classList.add('hidden');
        if(!isDefault) showToast("Model Swapped. Bone ID reset to 22.");
    });
}

// 4. Input Listeners
document.getElementById('fbxInput').addEventListener('change', (e) => {
    if (e.target.files[0]) {
        const url = URL.createObjectURL(e.target.files[0]);
        loadFBX(url);
    }
});

document.getElementById('csvInput').addEventListener('change', (e) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        const lines = event.target.result.split(/\r?\n/).filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        
        const bCountIdx = headers.indexOf('BlendshapeCount');
        const yawIdx = headers.indexOf('HeadYaw');
        shapeNames = headers.slice(bCountIdx + 1, yawIdx);
        
        csvData = lines.slice(1).map(line => {
            const cols = line.split(',');
            const obj = {};
            headers.forEach((h, i) => obj[h] = cols[i]);
            return obj;
        });

        const trimStart = document.getElementById('trimStart');
        const trimEnd = document.getElementById('trimEnd');
        trimStart.max = trimEnd.max = csvData.length - 1;
        trimStart.value = 0;
        trimEnd.value = csvData.length - 1;
        
        const fps = parseFloat(document.getElementById('fpsInput').value) || 60;
        document.getElementById('totalTimeDisplay').innerText = formatTime(csvData.length / fps);
        
        document.getElementById('trimUI').classList.remove('hidden');
        document.getElementById('playbackUI').classList.remove('hidden');
        updateTrimLabel();
        startTime = 0;
        isPlaying = true;
    };
    reader.readAsText(e.target.files[0]);
});

// 5. UI Controls
document.getElementById('boneSelect').addEventListener('change', (e) => {
    const selectedName = e.target.value;
    
    model.traverse(child => {
        if (child.isBone && child.name === selectedName) {
            headBone = child;
            
            // Note: We are NOT changing the boneIdInput here anymore.
            // If the user selects a bone in the dropdown, it only affects 
            // the 3D preview. The ID 22 remains in the box for export.
            
            showToast(`Previewing rotation on: ${selectedName}`);
        }
    });
});

document.getElementById('playBtn').onclick = () => { isPlaying = true; startTime = 0; };
document.getElementById('stopBtn').onclick = () => { isPlaying = false; };
document.getElementById('saveXpf').onclick = () => exportFiles('XPF');
document.getElementById('saveXaf').onclick = () => exportFiles('XAF');
document.querySelectorAll('input[type="range"]').forEach(i => i.oninput = updateTrimLabel);

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toFixed(2).padStart(5, '0');
    return `${mins}:${secs}`;
}

function updateTimeDisplay(frame, fps) {
    document.getElementById('currentTimeDisplay').innerText = formatTime(frame / fps);
}

function updateTrimLabel() {
    const s = document.getElementById('trimStart').value;
    const e = document.getElementById('trimEnd').value;
    document.getElementById('trimStatus').innerText = `Frames: ${s} - ${e} (Total: ${e - s})`;
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg; t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

// 6. Export logic
async function exportFiles(type) {
    const fps = parseFloat(document.getElementById('fpsInput').value);
    const start = parseInt(document.getElementById('trimStart').value);
    const end = parseInt(document.getElementById('trimEnd').value);
    const trimmedData = csvData.slice(start, end + 1);
    const duration = (trimmedData.length - 1) / fps;

    if (type === 'XPF') {
        let xpf = `<HEADER MAGIC="XPF" VERSION="919"/>\n<ANIMATION NUMTRACKS="${shapeNames.length}" DURATION="${duration.toFixed(5)}">\n`;
        shapeNames.forEach(shape => {
            const morph = shape.charAt(0).toLowerCase() + shape.slice(1);
            xpf += `  <TRACK NUMKEYFRAMES="${trimmedData.length}" MORPHNAME="${morph}">\n`;
            trimmedData.forEach((row, i) => {
                xpf += `    <KEYFRAME TIME="${(i/fps).toFixed(5)}"><WEIGHT>${parseFloat(row[shape] || 0).toFixed(6)}</WEIGHT></KEYFRAME>\n`;
            });
            xpf += `  </TRACK>\n`;
        });
        xpf += `</ANIMATION>\n`;
        saveWithDialog(xpf, 'animation.xpf');
    } else {
        const boneId = document.getElementById('boneIdInput').value;
        let xaf = `<HEADER MAGIC="XAF" VERSION="919"/>\n<ANIMATION DURATION="${duration.toFixed(5)}" NUMTRACKS="1">\n`;
        xaf += `  <TRACK BONEID="${boneId}" NUMKEYFRAMES="${trimmedData.length}">\n`;
        trimmedData.forEach((row, i) => {
            const q = eulerToQuat(parseFloat(row.HeadYaw || 0), parseFloat(row.HeadPitch || 0), parseFloat(row.HeadRoll || 0));
            xaf += `    <KEYFRAME TIME="${(i/fps).toFixed(5)}">\n      <TRANSLATION>18.853024 -0.000014 0.000014</TRANSLATION>\n`;
            xaf += `      <ROTATION>${q.x.toFixed(6)} ${q.y.toFixed(6)} ${q.z.toFixed(6)} ${q.w.toFixed(6)}</ROTATION>\n    </KEYFRAME>\n`;
        });
        xaf += `  </TRACK>\n</ANIMATION>\n`;
        saveWithDialog(xaf, 'animation.xaf');
    }
}

async function saveWithDialog(content, name) {
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: name });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            showToast("Saved!");
        } catch(e) {}
    } else {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
    }
}

function eulerToQuat(y, p, r) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, r));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// 7. Initialize
init();
window.addEventListener('load', () => {
    loadFBX('sample_head.fbx', true); 
});
