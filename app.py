import customtkinter as ctk
import subprocess
import sys
import threading
import re
from tkinter import messagebox

# ================= UI CONFIG =================

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

app = ctk.CTk()
app.geometry("780x650")
app.title("Brit NRAD Automation ENTERPRISE")
app.resizable(False, False)

# ================= GLOBALS =================

current_process = None
process_running = False
start_row_global = 1
total_rows_global = 100

PROJECTS = {
    "V1": {
        "articles": "V1_Full_Articles.py",
        "publisher": "V1_Full_Publisher.py"
    },
    "V2": {
        "articles": "V2_Full_Articles.py",
        "publisher": "V2_Full_Publisher.py"
    }
}

selected_project = ctk.StringVar(value="V1")

# ================= LOG =================

def log(msg):
    log_box.configure(state="normal")
    log_box.insert("end", msg + "\n")
    log_box.see("end")
    log_box.configure(state="disabled")

# ================= STATUS =================

def set_status(text, color):
    status_label.configure(text=f"Status: {text}", text_color=color)

# ================= PROCESS CONTROL =================

def stop_process():
    global current_process, process_running
    if current_process and process_running:
        log("⛔ STOP REQUESTED")
        try:
            current_process.terminate()
            current_process.kill()
        except:
            pass
    on_process_end()

def on_process_end():
    global process_running
    process_running = False
    progress.set(0)
    percent_label.configure(text="0%")
    set_status("IDLE", "gray")
    log("✅ PROCESS STOPPED / FINISHED")

def stream_output(process):
    global start_row_global

    for line in iter(process.stdout.readline, ""):
        if not line:
            break

        clean = line.rstrip()
        log(clean)

        match = re.search(r'row\s+(\d+)', clean, re.IGNORECASE)
        if match:
            current_row = int(match.group(1))
            progress_value = (current_row - start_row_global) / max(1, total_rows_global)
            progress_value = max(0, min(progress_value, 1))
            progress.set(progress_value)
            percent_label.configure(text=f"{int(progress_value * 100)}%")

    process.wait()
    on_process_end()

def start_process(script_path, args, start_row):
    global current_process, process_running, start_row_global

    if process_running:
        messagebox.showinfo("Running", "Process already running")
        return

    start_row_global = start_row
    process_running = True

    set_status("RUNNING", "green")
    log(f"▶ PROJECT {selected_project.get()} | START {script_path}")

    current_process = subprocess.Popen(
        [sys.executable, script_path] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )

    threading.Thread(
        target=stream_output,
        args=(current_process,),
        daemon=True
    ).start()

# ================= SETTINGS PANEL =================

def clear_settings():
    for w in settings_frame.winfo_children():
        w.destroy()

def show_full_articles():
    clear_settings()

    project = selected_project.get()
    script = PROJECTS[project]["articles"]

    ctk.CTkLabel(settings_frame, text=f"Full Articles ({project})", font=("Arial", 16, "bold")).pack(pady=10)

    ctk.CTkLabel(settings_frame, text="Start Row").pack()
    sr = ctk.CTkEntry(settings_frame)
    sr.insert(0, "1")
    sr.pack()

    ctk.CTkLabel(settings_frame, text="Wait Time (seconds)").pack(pady=5)
    wt = ctk.CTkEntry(settings_frame)
    wt.insert(0, "190")
    wt.pack()

    ctk.CTkButton(
        settings_frame,
        text="▶ START",
        fg_color="green",
        height=40,
        command=lambda: start_process(
            script,
            [sr.get(), wt.get()],
            int(sr.get())
        )
    ).pack(pady=(15, 5))

    ctk.CTkButton(
        settings_frame,
        text="⛔ STOP",
        fg_color="red",
        height=38,
        command=stop_process
    ).pack(pady=(5, 10))

def show_publisher():
    clear_settings()

    project = selected_project.get()
    script = PROJECTS[project]["publisher"]

    ctk.CTkLabel(settings_frame, text=f"Publisher ({project})", font=("Arial", 16, "bold")).pack(pady=10)

    ctk.CTkLabel(settings_frame, text="Start Row").pack()
    sr = ctk.CTkEntry(settings_frame)
    sr.insert(0, "1")
    sr.pack()

    ctk.CTkButton(
        settings_frame,
        text="▶ START",
        fg_color="purple",
        height=40,
        command=lambda: start_process(
            script,
            [sr.get()],
            int(sr.get())
        )
    ).pack(pady=(20, 5))

    ctk.CTkButton(
        settings_frame,
        text="⛔ STOP",
        fg_color="red",
        height=38,
        command=stop_process
    ).pack(pady=(5, 10))

# ================= MAIN UI =================

ctk.CTkLabel(app, text="Brit NRAD Automation ENTERPRISE", font=("Arial", 24, "bold")).pack(pady=15)

# Project Selector
project_frame = ctk.CTkFrame(app)
project_frame.pack(pady=5)

ctk.CTkLabel(project_frame, text="Project").pack(side="left", padx=5)
ctk.CTkOptionMenu(
    project_frame,
    values=["V1", "V2"],
    variable=selected_project
).pack(side="left", padx=5)

# Main buttons
top = ctk.CTkFrame(app)
top.pack(pady=8)

ctk.CTkButton(top, text="🟦 Full Articles", command=show_full_articles).grid(row=0, column=0, padx=10)
ctk.CTkButton(top, text="🟣 Full Articles Publisher", fg_color="purple", command=show_publisher).grid(row=0, column=1, padx=10)

settings_frame = ctk.CTkFrame(app, height=220)
settings_frame.pack(fill="x", padx=20, pady=10)

status_label = ctk.CTkLabel(app, text="Status: IDLE", text_color="gray")
status_label.pack()

progress = ctk.CTkProgressBar(app, width=540)
progress.pack(pady=5)

percent_label = ctk.CTkLabel(app, text="0%")
percent_label.pack()

ctk.CTkLabel(app, text="Live Logs").pack(pady=(10, 5))

log_box = ctk.CTkTextbox(app, height=200)
log_box.pack(padx=20, fill="x")
log_box.configure(state="disabled")

ctk.CTkButton(app, text="❌ EXIT APP", fg_color="red", command=app.destroy).pack(pady=15)

app.mainloop()
