from pathlib import Path
from streamlit.testing.v1 import AppTest
p = Path(__file__).resolve().parents[1] / "src/neoscope/app/main.py"
at = AppTest.from_file(str(p), default_timeout=900)
at.run()
print("errors:", [e.value for e in at.error])
print("warnings:", [w.value for w in at.warning])
print("buttons:", [b.label for b in at.button])
print("select_slider:", [s.label for s in at.select_slider])
print("radio:", [r.label for r in at.radio])
print("n metrics:", len(at.metric))
print("tabs:", [t.label for t in at.tabs])
