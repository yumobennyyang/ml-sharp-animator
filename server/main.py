import logging
import shutil
import sys
import subprocess
import mimetypes
import json
import asyncio
import re
import uuid
import zipfile
import os
from pathlib import Path
from typing import List, Dict

mimetypes.add_type("application/octet-stream", ".ply")

from fastapi import FastAPI, File, UploadFile, Request, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("server_debug.log"),
        logging.StreamHandler(sys.stdout)
    ]
)

print("--- SERVER RELOADED WITH WEBSOCKET SUPPORT ---")

# Setup directories
BASE_DIR = Path(__file__).resolve().parent.parent
SERVER_DIR = BASE_DIR / "server"
TEMP_DIR = SERVER_DIR / "temp_data"
STATIC_DIR = SERVER_DIR / "static"
TEMPLATES_DIR = SERVER_DIR / "templates"

# Clean up temp directory on startup
if TEMP_DIR.exists():
    shutil.rmtree(TEMP_DIR)
TEMP_DIR.mkdir(exist_ok=True)

# Serve web/dist as static files
WEB_EXAMPLE_DIST = BASE_DIR / "web" / "dist"

if not WEB_EXAMPLE_DIST.exists():
    logging.warning(f"Web dist directory not found at {WEB_EXAMPLE_DIST}. Did you run 'npm run build' in the web directory?")

# Mount the assets directory specifically to handle /assets requests
app.mount("/assets", StaticFiles(directory=WEB_EXAMPLE_DIST / "assets"), name="assets")
# Mount temp directory to serve generated files
app.mount("/temp", StaticFiles(directory=TEMP_DIR), name="temp")

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_personal_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    print(f"--- WEBSOCKET ENDPOINT HIT: {client_id} ---")
    await manager.connect(websocket, client_id)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        print(f"--- WEBSOCKET DISCONNECTED: {client_id} ---")



@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    batch_id = str(uuid.uuid4())
    batch_dir = TEMP_DIR / batch_id
    batch_dir.mkdir(exist_ok=True)

    # Save uploaded file
    input_path = batch_dir / file.filename
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Run sharp predict
    sharp_exe = shutil.which("sharp")
    if not sharp_exe:
        return {"error": "sharp executable not found in PATH"}

    cmd = [
        sharp_exe, "predict",
        "-i", str(input_path),
        "-o", str(batch_dir),
        "--device", "cpu"
    ]
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            logging.error(f"Sharp command failed: {stderr.decode()}")
            return {"error": f"Prediction failed: {stderr.decode()}"}
            
    except Exception as e:
        logging.exception("Unexpected error during prediction")
        return {"error": f"Server error: {str(e)}"}

    output_filename = f"{input_path.stem}.ply"
    output_path = batch_dir / output_filename
    
    if not output_path.exists():
        return {"error": "Output file was not generated."}

    return {
        "ply_url": f"/temp/{batch_id}/{output_filename}",
        "batch_id": batch_id
    }

@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...), client_id: str = Form(None)):
    batch_id = str(uuid.uuid4())
    batch_dir = TEMP_DIR / batch_id
    batch_dir.mkdir(exist_ok=True)
    
    # Save uploaded video
    video_path = batch_dir / file.filename
    with open(video_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Create directory for frames
    frames_dir = batch_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    
    if client_id:
        await manager.send_personal_message("Processing video...", client_id)

    # 2. Extract frames using ffmpeg at 12 FPS
    ffmpeg_cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vf", "fps=12",
        str(frames_dir / "%02d.png")
    ]
    
    try:
        process = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            logging.error(f"ffmpeg failed: {stderr.decode()}")
            return {"error": f"Frame extraction failed: {stderr.decode()}"}
            
        # Count actual frames
        frames = sorted(list(frames_dir.glob("*.png")))
        total_frames = len(frames)
        

            
    except FileNotFoundError:
        return {"error": "ffmpeg not found. Please install ffmpeg."}
    except Exception as e:
        return {"error": f"Frame extraction error: {str(e)}"}

    # Create directory for output PLYs
    plys_dir = batch_dir / "plys"
    plys_dir.mkdir(exist_ok=True)
    
    # 3. Process each frame
    ply_urls = []
    sharp_exe = shutil.which("sharp")
    if not sharp_exe:
        logging.error("sharp executable not found in PATH")
        return {"error": "sharp executable not found in PATH"}

    logging.info(f"Found sharp at: {sharp_exe}")
    logging.info(f"Processing {len(frames)} frames")

    for i, frame_path in enumerate(frames):
        if client_id:
            await manager.send_personal_message(f"Converting to PLYs ({i+1}/{total_frames})", client_id)
            await asyncio.sleep(0) 

        cmd = [
            sharp_exe, "predict",
            "-i", str(frame_path),
            "-o", str(plys_dir),
            "--device", "cpu"
        ]
        
        try:
            logging.info(f"Running sharp for {frame_path.name}")
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                output_filename = f"{frame_path.stem}.ply"
                output_path = plys_dir / output_filename
                
                if output_path.exists():
                    ply_url = f"/temp/{batch_id}/plys/{output_filename}"
                    ply_urls.append(ply_url)
                    logging.info(f"Generated PLY: {ply_url}")
                else:
                    logging.warning(f"Output PLY not found for frame {frame_path.name} at {output_path}")
            else:
                logging.error(f"Sharp failed for {frame_path.name}: {stderr.decode()}")
                logging.error(f"Sharp stdout: {stdout.decode()}")
                
        except Exception as e:
            logging.error(f"Sharp execution error for {frame_path.name}: {str(e)}")
            continue

    if client_id:
        await manager.send_personal_message("Loading splat...", client_id)

    logging.info(f"Returning {len(ply_urls)} PLY URLs")
    return {
        "ply_urls": ply_urls,
        "batch_id": batch_id
    }

@app.get("/download_zip/{batch_id}")
async def download_zip(batch_id: str):
    batch_dir = TEMP_DIR / batch_id
    if not batch_dir.exists():
        return HTMLResponse("Batch not found", status_code=404)
    
    # Determine what to zip
    # If there's a 'plys' directory, zip that (video case)
    # If not, zip all .ply files in the batch_dir (single image case)
    
    zip_filename = f"{batch_id}.zip"
    zip_path = batch_dir / zip_filename
    
    plys_dir = batch_dir / "plys"
    
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            if plys_dir.exists():
                for root, _, files in os.walk(plys_dir):
                    for file in files:
                        if file.endswith(".ply"):
                            file_path = Path(root) / file
                            arcname = file # Store just the filename in the zip
                            zipf.write(file_path, arcname)
            else:
                for file in batch_dir.glob("*.ply"):
                    zipf.write(file, file.name)
                    
        return FileResponse(zip_path, filename="ply_files.zip", media_type="application/zip")
        
    except Exception as e:
        logging.error(f"Failed to create zip: {e}")
        return HTMLResponse("Failed to create zip", status_code=500)

@app.get("/{full_path:path}")
async def read_root(request: Request, full_path: str):
    # Serve index.html for all non-asset routes to support client-side routing if needed
    # or just for the root path.
    
    if full_path.startswith("ws/") or full_path.startswith("download_zip/"):
        return HTMLResponse(status_code=404)

    # First check if the file exists in the dist directory (e.g. samples/...)
    file_path = WEB_EXAMPLE_DIST / full_path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    if full_path.startswith("assets"):
         return FileResponse(WEB_EXAMPLE_DIST / full_path)
    
    return FileResponse(WEB_EXAMPLE_DIST / "index.html")
