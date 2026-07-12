import json

path = "/root/.config/opencode/opencode.jsonc"
cfg = json.load(open(path))
cfg["mcp"] = {
    "hub": {
        "type": "remote",
        "url": "http://localhost:4096/mcp",
        "enabled": True,
    }
}
f = open(path, "w")
json.dump(cfg, f, indent=2)
f.close()
print("Config updated")
