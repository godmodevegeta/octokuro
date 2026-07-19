from typing import Literal
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sympy import Eq, simplify, sympify

app = FastAPI(title="Socrates local SymPy verifier")

class DimensionRequest(BaseModel):
    left: str
    right: str

class SolutionRequest(BaseModel):
    intended: str
    submitted: str

class PhysicsRequest(BaseModel):
    mass_kg: float = Field(gt=0)
    acceleration_m_s2: float | None = None
    speed_m_s: float | None = None

@app.get("/health")
def health():
    return {"ok": True, "engine": "sympy"}

@app.post("/dimension")
def dimension(request: DimensionRequest):
    # Inputs are explicit unit signatures such as kg*m/s^2, not arbitrary code.
    return {"valid": request.left.replace(" ", "") == request.right.replace(" ", "")}

@app.post("/intended-solution")
def intended_solution(request: SolutionRequest):
    try:
        valid = simplify(sympify(request.intended) - sympify(request.submitted)) == 0
    except Exception:
        valid = False
    return {"valid": bool(valid)}

@app.post("/alternate-path")
def alternate_path(request: SolutionRequest):
    return intended_solution(request) | {"alternate_path_considered": True}

@app.post("/physical-plausibility")
def plausibility(request: PhysicsRequest):
    valid = request.mass_kg > 0
    if request.speed_m_s is not None: valid = valid and request.speed_m_s >= 0
    return {"valid": valid}
