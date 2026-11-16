#!/usr/bin/env python3
"""A hand-run smoke test of the new-course talk (and, with --build, the
build job) against the REAL claude. Not part of `npm run check`.

It spends plan usage: the talk is two or three Sonnet turns with web search;
a build is one long Opus job (tens of minutes) plus up to three repair turns.
As of 16 Nov 2026 this flow has only ever run against server/tests/fake_claude.py.

Start the server first (`npm run server`, or with --port), then:

    env -u PYTHONPATH python3 server/smoke_new_course.py --port 8791
    env -u PYTHONPATH python3 server/smoke_new_course.py --port 8791 --build

It opens a new-course session from map node 15Axx, says what to learn in
enough detail that the session can write a brief soon, answers its questions
with "Yes, that's right. Please write the brief now." up to twice, then prints
the draft the server parsed (brief, problems, state). With --build it starts
the build and prints the log as it grows until the build ends. The course it
writes (if it passes) lands in content/ uncommitted, like any built course;
delete the folder if you don't want it.
"""

import argparse
import http.client
import json
import time

OPENING = ("I want to learn eigenvalues and eigenvectors of 2x2 matrices properly, by hand, because the SVD "
           "course assumed them. I can multiply matrices and solve quadratics. Four lessons is plenty.")
NUDGE = "Yes, that's right. Please write the brief now."


def call(port, method, path, body=None, timeout=900):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    headers = {"Content-Type": "application/json"} if body is not None else {}
    conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
    response = conn.getresponse()
    return conn, response


def get(port, path):
    conn, response = call(port, "GET", path)
    data = json.loads(response.read())
    conn.close()
    return response.status, data


def turn(port, sid, text):
    conn, response = call(port, "POST", "/api/turn", {"sessionId": sid, "text": text})
    if response.status != 200:
        print("  refused:", response.status, response.read().decode()[:300])
        conn.close()
        return None
    name, end = None, None
    for raw in response:
        line = raw.decode("utf-8").rstrip("\n")
        if line.startswith("event: "):
            name = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
            if name == "note":
                print("  note:", data["text"])
            elif name in ("done", "error"):
                end = (name, data)
    conn.close()
    return end


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--build", action="store_true", help="also start the build and follow it")
    args = parser.parse_args()

    conn, response = call(args.port, "POST", "/api/session", {"kind": "new-course", "context": {"nodeId": "15Axx"}})
    body = json.loads(response.read())
    conn.close()
    sid, did = body["sessionId"], body["draftId"]
    print("session", sid, "draft", did)

    for i, text in enumerate([OPENING, NUDGE, NUDGE]):
        print("\n> %s" % text)
        end = turn(args.port, sid, text)
        if not end:
            return
        name, data = end
        print(data.get("text") if name == "done" else "ERROR: " + data["message"])
        _, draft = get(args.port, "/api/draft?id=" + did)
        if draft["brief"] is not None:
            break

    _, draft = get(args.port, "/api/draft?id=" + did)
    print("\nDraft state:", draft["state"])
    print(json.dumps(draft["brief"], indent=1, ensure_ascii=False))
    for problem in draft["problems"]:
        print("  problem:", problem)
    if not args.build or draft["state"] != "ready":
        return

    conn, response = call(args.port, "POST", "/api/build", {"draftId": did})
    body = json.loads(response.read())
    conn.close()
    if response.status != 200:
        print("build refused:", body)
        return
    bid, shown = body["buildId"], 0
    print("\nbuild", bid)
    while True:
        _, build = get(args.port, "/api/build?id=" + bid)
        for line in build["log"][shown:]:
            print("  %s  %s" % (line["at"], line["text"]))
        shown = len(build["log"])
        if build["state"] in ("done", "failed", "stopped"):
            break
        time.sleep(10)
    print("\nBuild", build["state"], "after round", build["round"])
    for problem in build["problems"]:
        print("  problem:", problem)
    print("\nThe session's report:\n" + (build.get("report") or "(none)"))


if __name__ == "__main__":
    main()
