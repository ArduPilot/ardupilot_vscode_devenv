#! /usr/bin/env python3

import sys
import importlib.util
import json

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(1)
    script_path = sys.argv[1]
    spec = importlib.util.spec_from_file_location("module.name", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    json_str = ""
    # convert module to json
    print("[", end="")
    for option in module.BUILD_OPTIONS:
        # print utf8 without end
        if option == module.BUILD_OPTIONS[-1]:
            print(json.dumps(option.__dict__), end="")
        else:
            print(json.dumps(option.__dict__), end=",\n")
    print("]")
