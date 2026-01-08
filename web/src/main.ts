import {
	DEFAULT_TRAJECTORY_PARAMS,
	type TrajectoryType,
} from "./trajectory/types";
import { GaussianViewer } from "./viewer/GaussianViewer";

console.log("[main] Script loaded");

// Get DOM elements
const containerElement = document.getElementById("canvas-container");
console.log("[main] Container element:", containerElement);
const fileLoaderElement = document.getElementById("file-loader");
const fileInputElement = document.getElementById(
	"file-input",
) as HTMLInputElement;
const trajectorySelectElement = document.getElementById(
	"trajectory-select",
) as HTMLSelectElement;
const playButtonElement = document.getElementById(
	"play-btn",
) as HTMLButtonElement;
const pauseButtonElement = document.getElementById(
	"pause-btn",
) as HTMLButtonElement;
const resetButtonElement = document.getElementById(
	"reset-btn",
) as HTMLButtonElement;
const loadingElement = document.getElementById("loading");
const loadingTextElement = document.getElementById("loading-text");
const loadSampleButtonElement = document.getElementById(
	"load-sample-btn",
) as HTMLButtonElement;
const loadSampleVideoButtonElement = document.getElementById(
	"load-sample-video-btn",
) as HTMLButtonElement;
const downloadPlyButtonElement = document.getElementById(
	"download-ply-btn",
) as HTMLButtonElement;

// Advanced settings elements
const advancedToggleElement = document.getElementById(
	"advanced-toggle",
) as HTMLButtonElement;
const advancedPanelElement = document.getElementById(
	"advanced-panel",
) as HTMLDivElement;
const maxDisparityInputElement = document.getElementById(
	"max-disparity-input",
) as HTMLInputElement;
const maxZoomInputElement = document.getElementById(
	"max-zoom-input",
) as HTMLInputElement;
const distanceInputElement = document.getElementById(
	"distance-input",
) as HTMLInputElement;
const numStepsInputElement = document.getElementById(
	"num-steps-input",
) as HTMLInputElement;
const numRepeatsInputElement = document.getElementById(
	"num-repeats-input",
) as HTMLInputElement;
const resetParamsButtonElement = document.getElementById(
	"reset-params-btn",
) as HTMLButtonElement;

if (!containerElement) {
	throw new Error("Canvas container not found");
}

console.log("[main] Initializing GaussianViewer...");

// Initialize viewer
const viewer = new GaussianViewer({
	container: containerElement,
	onLoad: () => {
		console.log("[main] Splat loaded successfully");
		hideLoading();
		enableControls();
	},
	onError: (error) => {
		console.error("[main] Failed to load splat:", error);
		hideLoading();
		alert(`Failed to load PLY file: ${error.message}`);
	},
	onTrajectoryStateChange: (state) => {
		console.log("[main] Trajectory state changed:", state);
		updateButtonStates(state);
	},
	onFrameChange: (_frame, _total) => {
		// Could add a progress indicator here
	}

	// Canvas stays fixed size - splat renders with empty space around it as needed
});

console.log("[main] GaussianViewer initialized");

let currentBatchId: string | null = null;

// WebSocket for progress updates
const clientId = crypto.randomUUID();
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;
console.log("[main] Connecting to WebSocket:", wsUrl);

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
	console.log("[main] WebSocket connected");
};

ws.onmessage = (event) => {
	console.log("[main] WebSocket message:", event.data);
	showLoading(event.data);
};

ws.onerror = (error) => {
	console.error("[main] WebSocket error:", error);
};

// UI State Management
function showLoading(message = "Loading splat..."): void {
	if (loadingTextElement) loadingTextElement.textContent = message;
	loadingElement?.classList.add("visible");
}

function hideLoading(): void {
	loadingElement?.classList.remove("visible");
}

function setParameterControlsDisabled(disabled: boolean): void {
	if (advancedToggleElement) advancedToggleElement.disabled = disabled;
	if (maxDisparityInputElement) maxDisparityInputElement.disabled = disabled;
	if (maxZoomInputElement) maxZoomInputElement.disabled = disabled;
	if (distanceInputElement) distanceInputElement.disabled = disabled;
	if (numStepsInputElement) numStepsInputElement.disabled = disabled;
	if (numRepeatsInputElement) numRepeatsInputElement.disabled = disabled;
	if (resetParamsButtonElement) resetParamsButtonElement.disabled = disabled;
}

function enableControls(): void {
	if (trajectorySelectElement) trajectorySelectElement.disabled = false;
	if (playButtonElement) playButtonElement.disabled = false;
	if (pauseButtonElement) pauseButtonElement.disabled = false;
	if (resetButtonElement) resetButtonElement.disabled = false;
	setParameterControlsDisabled(false);
}

function disableControls(): void {
	if (trajectorySelectElement) trajectorySelectElement.disabled = true;
	if (playButtonElement) playButtonElement.disabled = true;
	if (pauseButtonElement) pauseButtonElement.disabled = true;
	if (resetButtonElement) resetButtonElement.disabled = true;
	setParameterControlsDisabled(true);
}

function updateButtonStates(state: "stopped" | "playing" | "paused"): void {
	if (playButtonElement) playButtonElement.disabled = state === "playing";
	if (pauseButtonElement) pauseButtonElement.disabled = state !== "playing";
	// Disable parameter controls during playback
	setParameterControlsDisabled(state === "playing");
}

// File Loading
async function loadFiles(files: File[]): Promise<void> {
	console.log("[main] loadFiles called with", files.length, "files");

	// Reset batch ID and hide download button when loading new files
	currentBatchId = null;
	if (downloadPlyButtonElement) downloadPlyButtonElement.style.display = "none";

	if (files.length === 0) return;

	// Validate files
	const validFiles: File[] = [];
	for (const file of files) {
		const isPly = file.name.toLowerCase().endsWith(".ply");
		const isPng = file.name.toLowerCase().endsWith(".png");
		const isVideo = file.name.toLowerCase().match(/\.(mp4|mov|avi)$/);
		if (isPly || isPng || isVideo) {
			validFiles.push(file);
		}
	}

	// Sort files alphabetically to ensure consistent order
	validFiles.sort((a, b) => a.name.localeCompare(b.name));

	if (validFiles.length === 0) {
		alert("Please select PLY, PNG, or video files");
		return;
	}

	// Check for video file
	const videoFile = validFiles.find((f) =>
		f.name.toLowerCase().match(/\.(mp4|mov|avi)$/),
	);

	if (videoFile) {
		if (validFiles.length > 1) {
			alert("Please upload only one video file at a time.");
			return;
		}

		console.log("[main] Video file detected:", videoFile.name);
		showLoading("Processing video...");
		disableControls(); // Disable controls during video processing

		const formData = new FormData();
		formData.append("file", videoFile);
		formData.append("client_id", clientId);

		try {
			const response = await fetch("/upload_video", {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Upload failed: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			const result = await response.json();
			if (result.error) {
				throw new Error(result.error);
			}

			if (result.ply_urls && result.ply_urls.length > 0) {
				console.log("[main] Video processed, loading PLYs:", result.ply_urls);
				await viewer.loadPlyUrls(result.ply_urls);

				if (result.batch_id) {
					currentBatchId = result.batch_id;
					if (downloadPlyButtonElement) downloadPlyButtonElement.style.display = "block";
				}
			} else {
				throw new Error("No PLY files were generated from the video.");
			}
		} catch (error) {
			console.error("[main] Video upload error:", error);
			alert(
				`Video processing failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			hideLoading();
			enableControls(); // Re-enable controls on error
		}
		return;
	}

	// If not a video and more than 500 files, alert
	if (validFiles.length > 500) {
		alert("Please select up to 500 files");
		return;
	}

	// Handle PLY/PNG files (existing logic)
	console.log("[main] Processing", validFiles.length, "files");

	// Determine initial loading message
	const pngCount = validFiles.filter(f => f.name.toLowerCase().endsWith(".png")).length;
	if (pngCount > 0) {
		if (pngCount === 1 && validFiles.length === 1) {
			showLoading("Converting to PLY...");
		} else {
			showLoading(`Converting to PLYs (0/${pngCount})`);
		}
	} else {
		showLoading("Loading splat...");
	}

	disableControls(); // Disable controls during file processing

	try {
		// Process files: upload PNGs to convert, keep PLYs as is
		const processedFiles: File[] = [];

		let convertedCount = 0;
		const totalPngs = validFiles.filter(f => f.name.toLowerCase().endsWith(".png")).length;

		for (const file of validFiles) {
			if (file.name.toLowerCase().endsWith(".png")) {
				convertedCount++;
				if (totalPngs > 1) {
					showLoading(`Converting to PLYs (${convertedCount}/${totalPngs})`);
				}
				console.log("[main] Converting PNG to PLY:", file.name);
				const formData = new FormData();
				formData.append("file", file);

				const response = await fetch("/predict", {
					method: "POST",
					body: formData,
				});

				if (!response.ok) {
					throw new Error(`Conversion failed for ${file.name}`);
				}

				const result = await response.json();
				if (result.error) {
					throw new Error(result.error);
				}

				// Fetch the converted PLY file
				const plyResponse = await fetch(result.ply_url);
				const plyBlob = await plyResponse.blob();
				const plyFile = new File([plyBlob], file.name.replace(".png", ".ply"), {
					type: "application/octet-stream",
				});
				processedFiles.push(plyFile);

				// For single PNG, we also want to allow download if possible
				// But currently /predict only returns one file at a time and we don't have a batch context for multiple PNGs easily
				// unless we change how we handle multiple PNGs.
				// However, the backend /predict now returns batch_id.
				if (result.batch_id) {
					currentBatchId = result.batch_id;
				}
			} else {
				processedFiles.push(file);
			}
		}

		console.log(
			"[main] Loading",
			processedFiles.length,
			"PLY files into viewer",
		);
		showLoading("Loading splat...");
		await viewer.loadPlySequence(processedFiles);

		// If we have a batch ID (from the last PNG processed), show download button
		// Note: If multiple PNGs were uploaded, this only points to the last one's batch.
		// Ideally we'd group them, but for now this enables it for at least single PNGs or the last one.
		if (currentBatchId && downloadPlyButtonElement) {
			downloadPlyButtonElement.style.display = "block";
		}
	} catch (error) {
		console.error("[main] Error loading files:", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		alert(`Failed to load files: ${errorMessage}`);
		hideLoading();
		enableControls(); // Re-enable controls on error
	}
}

// Sample File Loading
// Sample File Loading
async function loadSampleImage(): Promise<void> {
	const sampleFileUrl = `${import.meta.env.BASE_URL}samples/sample.ply`;
	console.log("[main] Loading sample image from:", sampleFileUrl);

	// Hide download button for samples
	currentBatchId = null;
	if (downloadPlyButtonElement) downloadPlyButtonElement.style.display = "none";

	showLoading("Loading splat...");
	disableControls();

	try {
		const response = await fetch(sampleFileUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch sample: HTTP ${response.status}`);
		}
		const blob = await response.blob();
		const file = new File([blob], "sample.ply", {
			type: "application/octet-stream",
		});
		await viewer.loadPlySequence([file]);
	} catch (error) {
		hideLoading();
		console.error("[main] Failed to load sample file:", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		alert(`Failed to load sample file: ${errorMessage}`);
	}
}

async function loadSampleVideo(): Promise<void> {
	console.log("[main] Loading video sample...");

	// Hide download button for samples
	currentBatchId = null;
	if (downloadPlyButtonElement) downloadPlyButtonElement.style.display = "none";

	showLoading("Loading splat...");
	disableControls();

	try {
		const files: File[] = [];
		// Load frames 01 to 96
		for (let i = 1; i <= 96; i++) {
			const filename = `${String(i).padStart(2, "0")}.ply`;
			const url = `${import.meta.env.BASE_URL}samples/videoSample/${filename}`;

			// Sequential fetch is safer for order and network
			const response = await fetch(url);
			if (!response.ok) {
				console.warn(`Failed to fetch sample frame ${filename}: ${response.status}`);
				continue;
			}
			const blob = await response.blob();
			const file = new File([blob], filename, {
				type: "application/octet-stream",
			});
			files.push(file);
		}

		if (files.length === 0) {
			throw new Error("No sample files loaded");
		}

		console.log(`[main] Loaded ${files.length} sample frames`);
		await viewer.loadPlySequence(files);
	} catch (error) {
		hideLoading();
		console.error("[main] Failed to load sample files:", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		alert(`Failed to load sample files: ${errorMessage}`);
	}
}

// Event Listeners
fileInputElement?.addEventListener("change", (event) => {
	const target = event.target as HTMLInputElement;
	if (target.files && target.files.length > 0) {
		loadFiles(Array.from(target.files));
	}
});

fileLoaderElement?.addEventListener("click", () => {
	fileInputElement?.click();
});

// Drag and drop
fileLoaderElement?.addEventListener("dragover", (event) => {
	event.preventDefault();
	fileLoaderElement.classList.add("drag-over");
});

fileLoaderElement?.addEventListener("dragleave", () => {
	fileLoaderElement.classList.remove("drag-over");
});

fileLoaderElement?.addEventListener("drop", (event) => {
	event.preventDefault();
	fileLoaderElement.classList.remove("drag-over");

	if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
		loadFiles(Array.from(event.dataTransfer.files));
	}
});

// Load sample buttons
if (loadSampleButtonElement) {
	loadSampleButtonElement.addEventListener("click", () => {
		loadSampleImage();
	});
}

if (loadSampleVideoButtonElement) {
	loadSampleVideoButtonElement.addEventListener("click", () => {
		loadSampleVideo();
	});
}

if (downloadPlyButtonElement) {
	downloadPlyButtonElement.addEventListener("click", async () => {
		if (currentBatchId) {
			// Set loading state
			const originalText = downloadPlyButtonElement.textContent;
			downloadPlyButtonElement.textContent = "Downloading";
			downloadPlyButtonElement.disabled = true;
			downloadPlyButtonElement.classList.add("downloading");

			// Animate dots
			let dots = 0;
			const interval = setInterval(() => {
				dots = (dots + 1) % 4;
				downloadPlyButtonElement.textContent = `Downloading${".".repeat(dots)}`;
			}, 500);

			try {
				// Trigger download
				window.location.href = `/download_zip/${currentBatchId}`;

				// Reset after a delay (since we can't easily track download completion of a direct link)
				// A 3-second delay is usually enough to acknowledge the action
				setTimeout(() => {
					clearInterval(interval);
					if (downloadPlyButtonElement) {
						downloadPlyButtonElement.textContent = "Download";
						downloadPlyButtonElement.disabled = false;
						downloadPlyButtonElement.classList.remove("downloading");
					}
				}, 3000);
			} catch (e) {
				clearInterval(interval);
				downloadPlyButtonElement.textContent = "Download PLY(s)";
				downloadPlyButtonElement.disabled = false;
				downloadPlyButtonElement.classList.remove("downloading");
			}
		}
	});
}

// Trajectory controls
trajectorySelectElement?.addEventListener("change", () => {
	const type = trajectorySelectElement.value as TrajectoryType;
	viewer.setTrajectoryType(type);
});

playButtonElement?.addEventListener("click", () => {
	viewer.play();
});

pauseButtonElement?.addEventListener("click", () => {
	viewer.pause();
});

resetButtonElement?.addEventListener("click", () => {
	viewer.reset();
});

// Advanced settings toggle
advancedToggleElement?.addEventListener("click", () => {
	const isExpanded = advancedToggleElement.classList.toggle("expanded");
	advancedToggleElement.setAttribute("aria-expanded", String(isExpanded));
	advancedPanelElement?.classList.toggle("collapsed", !isExpanded);
});

// Wire up parameter controls
maxDisparityInputElement?.addEventListener("input", () => {
	const value = Number.parseFloat(maxDisparityInputElement.value);
	if (!Number.isNaN(value)) {
		viewer.updateTrajectoryParam("maxDisparity", value);
	}
});

maxZoomInputElement?.addEventListener("input", () => {
	const value = Number.parseFloat(maxZoomInputElement.value);
	if (!Number.isNaN(value)) {
		viewer.updateTrajectoryParam("maxZoom", value);
	}
});

distanceInputElement?.addEventListener("input", () => {
	const value = Number.parseFloat(distanceInputElement.value);
	if (!Number.isNaN(value)) {
		viewer.updateTrajectoryParam("distanceMeters", value);
	}
});

numStepsInputElement?.addEventListener("input", () => {
	const value = Number.parseInt(numStepsInputElement.value, 10);
	if (!Number.isNaN(value)) {
		viewer.updateTrajectoryParam("numSteps", value);
	}
});

numRepeatsInputElement?.addEventListener("input", () => {
	const value = Number.parseInt(numRepeatsInputElement.value, 10);
	if (!Number.isNaN(value)) {
		viewer.updateTrajectoryParam("numRepeats", value);
	}
});

// Reset to defaults
function updateParameterInputsFromDefaults(): void {
	const defaults = DEFAULT_TRAJECTORY_PARAMS;
	maxDisparityInputElement.value = String(defaults.maxDisparity);
	maxZoomInputElement.value = String(defaults.maxZoom);
	distanceInputElement.value = String(defaults.distanceMeters);
	numStepsInputElement.value = String(defaults.numSteps);
	numRepeatsInputElement.value = String(defaults.numRepeats);
}

resetParamsButtonElement?.addEventListener("click", () => {
	viewer.resetTrajectoryParams();
	updateParameterInputsFromDefaults();
});

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
	if (!viewer.isLoaded()) return;

	switch (event.key) {
		case " ":
			event.preventDefault();
			if (viewer.getPlayerState() === "playing") {
				viewer.pause();
			} else {
				viewer.play();
			}
			break;
		case "r":
		case "R":
			viewer.reset();
			break;
		case "Escape":
			viewer.stop();
			break;
	}
});

// Check for URL parameter to auto-load a file
const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get("file");

if (fileUrl) {
	showLoading();
	fetch(fileUrl)
		.then((response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.blob();
		})
		.then((blob) => {
			const file = new File([blob], "scene.ply", {
				type: "application/octet-stream",
			});
			return loadFiles([file]);
		})
		.catch((error) => {
			hideLoading();
			console.error("Failed to load file from URL:", error);
		});
}
