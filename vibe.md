# Vibe Coding: Isolated Git Worktrees

**Quick start:** From the project root, run `source scripts/vibe.sh` (or `. scripts/vibe.sh`). Then `vibe 3001` to create an isolated instance, and `unvibe 3001` to remove it.

---

Gemini
Conversation with Gemini
You said
I want to vibe code on a web app. I want to be able to do it in separate instances. I'm running localhost on my computer and I'm making changes in five different places. The problem is if I use localhost 3000, 3001, 3002, and so on. If I'm making changes which cause the program to crash on one, for example while I'm typing or getting outputted a new line of code, it will temporarily break the other websites. The other sites cause it's all connected.



I'm curious if there's a quick way to spin up separate instances such that they won't depend on each other, so I can make my quick change and remove it. Not work trees per se, because I don't want to be able to do long-winded stuff. I want to be able to make quick changes, delete it, and have it merge into the main, so to speak. Does this make sense? 

Gemini said
You are hitting a classic developer bottleneck: Shared State Collision.

Currently, your "instances" are just different processes looking at the same mirror. When you crack the mirror (syntax error) in one, the reflection breaks for everyone. To fix this, you don't just need separate ports; you need separate file systems.

You were right to be wary of Git Worktrees in their default state—manually managing them is tedious ("long-winded"). However, if we script them to be ephemeral and disposable, they become the exact "Vibe Coding" tool you need.

Here is the "Instant Clone" strategy to get you exactly what you asked for: isolated environments, instant setup, easy merge.

The Solution: "Vibe" Script
You can use a small shell function to automate the creation of a lightweight instance. This script does three things:

Creates a fresh Git branch & worktree (isolated code).

Symlinks your node_modules (instant setup, no npm install wait time).

Sets it up so you can "nuke" it when you're done.

Add this to your .zshrc or .bashrc, or just paste it into your terminal for this session:

Bash
# Usage: vibe <port_number>
# Example: vibe 3001
vibe() {
    local PORT=$1
    local INSTANCE_DIR="../vibe-$PORT"

    # 1. Create a new worktree with a temporary branch
    echo "🌊 Spinning up vibe instance on port $PORT..."
    git worktree add -b "vibe/port-$PORT" "$INSTANCE_DIR" HEAD

    # 2. Symlink node_modules to skip install time (The Speed Hack)
    # NOTE: If you install NEW packages in the instance, do it carefully.
    ln -s "$(pwd)/node_modules" "$INSTANCE_DIR/node_modules"

    # 3. Create a simple .env override if needed (Optional)
    # echo "PORT=$PORT" > "$INSTANCE_DIR/.env.local"

    echo "✅ Instance ready at: $INSTANCE_DIR"
    echo "🚀 To start: cd $INSTANCE_DIR && PORT=$PORT npm start"
}

# Usage: unvibe <port_number>
# Example: unvibe 3001
unvibe() {
    local PORT=$1
    local INSTANCE_DIR="../vibe-$PORT"
    local BRANCH="vibe/port-$PORT"

    echo "🧹 Cleaning up instance $PORT..."
    
    # Force delete the worktree and the branch
    git worktree remove --force "$INSTANCE_DIR"
    git branch -D "$BRANCH"
    
    echo "✨ Gone."
}
How to "Vibe Code" with this workflow
This solves your specific requirements of "Quick change, delete it, or merge it."

1. The Setup
You are in your main folder. You want to try a risky change on a new UI component.

Bash
vibe 3001
Result: A folder ../vibe-3001 is created instantly. It shares your node_modules so it's ready immediately.

2. The Execution
Open that new folder in a separate VS Code window.

Bash
code ../vibe-3001
Run the app on port 3001. Now, go ahead and break things. Type half-finished variables. Crash the server.

Main App (Port 3000): Still running perfectly.

Vibe App (Port 3001): Crashed, but isolated.

3. The "Merge" (If you like the code)
Since this is a real Git branch, you don't need to copy-paste text files.

In the Vibe instance: Commit your changes. git commit -am "Fixed the thing"

In your Main instance: git merge vibe/port-3001

4. The "Delete" (If the code was bad)
If the experiment failed and you want to pretend it never happened:

Bash
unvibe 3001
It nukes the folder and the git branch. No cleanup required.

Why this works better than other methods
VS Localhost: As you noted, localhost shares files. This method gives you physical file separation.

VS Docker: Docker isolates the runtime, but usually you mount your local drive to the container to edit code. If you mount the drive, you are back to the shared file problem. If you copy the files into Docker, you can't get them out easily. Worktrees sit in the middle: separate files, but easy to merge.

VS Manual Worktrees: Manual worktrees require you to run npm install every time (slow) and manage branch names. The symlink trick in the script above makes the startup time near-instant.

A Note on Dependencies
The script symlinks node_modules. This is great for speed, but:

Safe: Changing application code (.js, .tsx, .py).

Unsafe: Running npm install new-package inside the vibe instance. Because node_modules is shared, installing a package in the instance will modify it for your main folder too.

Fix: If you need to install different dependencies for an experiment, delete the symlink in that instance and run npm install normally.




Gemini is AI and can make mistakes.

