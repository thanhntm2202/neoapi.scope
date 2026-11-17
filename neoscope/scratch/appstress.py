from pathlib import Path
from streamlit.testing.v1 import AppTest
import itertools, traceback
p = Path(__file__).resolve().parents[1] / "src/neoscope/app/main.py"

def check(label, mutate):
    at = AppTest.from_file(str(p), default_timeout=900)
    at.run()
    try:
        mutate(at)
        at.run()
    except Exception as e:
        print(f"[{label}] HARNESS {type(e).__name__}: {e}"); return
    if at.exception:
        print(f"[{label}] EXC: {at.exception[0].message}")
        st = getattr(at.exception[0],'stack_trace',[])
        print("   ", [s for s in st if 'neoscope' in s][-2:])
    else:
        print(f"[{label}] ok  errors={[e.value for e in at.error]}")

def set_w(at, label, value):
    for coll in (at.select_slider, at.selectbox, at.radio, at.multiselect):
        for w in coll:
            if w.label == label:
                w.set_value(value); return True
    raise KeyError(label)

check("lhs time = first", lambda at: set_w(at, "Thời điểm đánh giá (UTC+7)", at.select_slider[0].options[0]))
check("exec side=MUA", lambda at: set_w(at, "Hướng lệnh", "MUA (quét ask)"))
check("exec notional=5e9", lambda at: set_w(at, "Quy mô lệnh (VND)", 5e9))
check("exec time=first", lambda at: set_w(at, "Thời điểm đặt lệnh (UTC+7)", [s for s in at.select_slider if s.label=="Thời điểm đặt lệnh (UTC+7)"][0].options[0]))
check("exec time=last", lambda at: set_w(at, "Thời điểm đặt lệnh (UTC+7)", [s for s in at.select_slider if s.label=="Thời điểm đặt lệnh (UTC+7)"][0].options[-1]))
def combo(at):
    set_w(at, "Hướng lệnh", "MUA (quét ask)")
    set_w(at, "Quy mô lệnh (VND)", 5e9)
    set_w(at, "Mã cổ phiếu", "VCB")
    at.button[0].click()
check("combo buy 5e9 VCB + sim", combo)
def combo2(at):
    at.sidebar.selectbox[0].set_value(at.sidebar.selectbox[0].options[2])
    set_w(at, "Soi cấu phần mã", "DIG")
    set_w(at, "Mã cổ phiếu", "PDR")
check("session3 + sym change", combo2)
def combo3(at):
    at.sidebar.selectbox[0].set_value(at.sidebar.selectbox[0].options[0])
    at.button[0].click()
check("session1 + sim click", combo3)
