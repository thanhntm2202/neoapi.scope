from pathlib import Path
from streamlit.testing.v1 import AppTest
p = Path(__file__).resolve().parents[1] / "src/neoscope/app/main.py"

def run(label, fn):
    at = AppTest.from_file(str(p), default_timeout=900)
    at.run()
    try:
        fn(at)
        at.run()
    except Exception as e:
        print(f"[{label}] HARNESS ERROR {type(e).__name__}: {e}")
        return
    if at.exception:
        print(f"[{label}] EXCEPTIONS {len(at.exception)}")
        for e in at.exception:
            print("   ", e.message)
            print("   ", (getattr(e,'stack_trace','') or '')[-1500:])
    else:
        print(f"[{label}] ok")

def click_sim(at):
    btns = [b for b in at.button]
    print("   buttons:", [b.label for b in btns])
    for b in btns:
        b.click()
run("click all buttons", click_sim)

def first_session(at):
    sb = at.sidebar.selectbox[0]
    sb.set_value(sb.options[0])
run("session = first (training)", first_session)

def change_sym(at):
    # selectbox in Q2 tab
    sbs = at.selectbox
    print("   selectboxes:", [s.label for s in sbs])
    for s in sbs:
        if s.label == "Mã cổ phiếu":
            s.set_value(s.options[-1])
run("Q2 symbol = last", change_sym)

def empty_filters(at):
    for m in at.multiselect:
        if m.label in ("Phiên","Loại cảnh báo","Mã"):
            m.set_value([])
run("alerts empty filters", empty_filters)

def no_symbols(at):
    for m in at.sidebar.multiselect:
        m.set_value([])
run("sidebar no symbols", no_symbols)
