"use strict";

var canvas, gl, program;

var CYL_SLICES = 96;         
var NumVertices = 0;          
var colors = [];
var points = [];


// Parameters controlling the size of the Robot's arm

var BASE_HEIGHT      = 2.0;
var BASE_WIDTH       = 5.0;
var LOWER_ARM_HEIGHT = 5.0;
var LOWER_ARM_WIDTH  = 0.5;
var UPPER_ARM_HEIGHT = 5.0;
var UPPER_ARM_WIDTH  = 0.5;

// --- Gripper (non-functional) sizes ---
var GRIPPER_PALM_HEIGHT = 0.3;
var GRIPPER_PALM_WIDTH  = 0.8;
var GRIPPER_PALM_DEPTH  = 0.4;

var FINGER_HEIGHT = 1.0;
var FINGER_WIDTH  = 0.18;
var FINGER_DEPTH  = 0.18;

var FINGER_GAP = 0.35;   // distance between fingers


// Shader transformation matrices

var modelViewMatrix, projectionMatrix;

// Array of rotation angles (in degrees) for each rotation axis

var Base = 0;
var LowerArm = 1;
var UpperArm = 2;

// Current angles for each joint
var theta= [ 0, 0, 0];
// Target angles for each joint
var targetTheta = [ 0, 0, 0];

// ===== Gripper control (functional) =====
var grip = {
  // This controls how far apart fingers are (model units)
  open: 0.55,          // current gap (start open)
  targetOpen: 0.55,    // target gap
  min: 0.15,           // fully closed gap
  max: 0.75,           // fully open gap
  smoothSpeed: 0.12    // smoothing factor per frame (like joint smoothSpeed)
};


var step = 10;
var smoothSpeed = 0.15;

// ===== Key mapping settings =====
var precisionMode = false;     // CAPS LOCK toggles this
var baseStepNormal = 10;
var baseStepPrec   = 1;

var armStepNormal  = 10;       // W/S and L/D use this
var armStepPrec    = 1;

var gripStepNormal = 0.08;     // R/F change gap (model units)
var gripStepPrec   = 0.02;

// Speed scaling (+ / -)
var speedMult = 1.0;
var SPEED_MIN = 0.25;
var SPEED_MAX = 3.0;

// Record / playback
var recordMode = false;
var playMode = false;
var savedPoses = [];     // array of { theta:[..], grip:.. }
var playIndex = 0;
var playHoldFrames = 10; // pause slightly at each pose
var playHoldCounter = 0;

// Joint angle limits
var LIMITS = {
    base: { min: -180, max: 180 },
    lowerArm: { min: -90, max: 90 },
    upperArm: { min: -90, max: 90 }
};

var angle = 0;

var modelViewMatrixLoc;

var vBuffer, cBuffer;

window.onload = init;
//----------------------------------------------------------------------------

function buildCylinder(slices) {
  points = [];
  colors = [];

  // Unit cylinder centered at origin:
  // y from -0.5 to +0.5, radius = 0.5
  var r = 0.5;
  var yTop = 0.5;
  var yBot = -0.5;

  var topCenter = vec4(0, yTop, 0, 1);
  var botCenter = vec4(0, yBot, 0, 1);

  function ringVertex(theta, y) {
    return vec4(r * Math.cos(theta), y, r * Math.sin(theta), 1);
  }

  // choose colors directly (no vertexColors needed)
  var sideColor = vec4(0.2, 0.2, 0.8, 1.0); // blue
  var capColor  = vec4(0.8, 0.8, 0.0, 1.0); // yellow

  for (var i = 0; i < slices; i++) {
    var a0 = (i / slices) * 2 * Math.PI;
    var a1 = ((i + 1) / slices) * 2 * Math.PI;

    var v0 = ringVertex(a0, yBot);
    var v1 = ringVertex(a1, yBot);
    var v2 = ringVertex(a1, yTop);
    var v3 = ringVertex(a0, yTop);

    // ---- side (2 triangles) ----
    colors.push(sideColor); points.push(v0);
    colors.push(sideColor); points.push(v1);
    colors.push(sideColor); points.push(v2);

    colors.push(sideColor); points.push(v0);
    colors.push(sideColor); points.push(v2);
    colors.push(sideColor); points.push(v3);

    // ---- top cap (1 triangle) ----
    colors.push(capColor); points.push(topCenter);
    colors.push(capColor); points.push(v3);
    colors.push(capColor); points.push(v2);

    // ---- bottom cap (1 triangle) ----
    colors.push(capColor); points.push(botCenter);
    colors.push(capColor); points.push(v1);
    colors.push(capColor); points.push(v0);
  }

  NumVertices = points.length;
}


function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function nameOfJoint(j) {
  if (j === Base) return "Base";
  if (j === LowerArm) return "Lower Arm";
  if (j === UpperArm) return "Upper Arm";
  return "Joint";
}

function limitsForJoint(j) {
  if (j === Base) return LIMITS.base;
  if (j === LowerArm) return LIMITS.lowerArm;
  if (j === UpperArm) return LIMITS.upperArm;
  return { min: -180, max: 180 };
}

function isPrecisionNow(e) {
  // CAPS LOCK state (works in most browsers)
  // Also keep a manual toggle in case some systems don't report it reliably.
  if (e && typeof e.getModifierState === "function") {
    precisionMode = e.getModifierState("CapsLock");
  }
  return precisionMode;
}

function currentStepDeg(e, forBaseOrArm) {
  var prec = isPrecisionNow(e);
  if (forBaseOrArm === "base") return prec ? baseStepPrec : baseStepNormal;
  return prec ? armStepPrec : armStepNormal;
}

function currentGripStep(e) {
  var prec = isPrecisionNow(e);
  return prec ? gripStepPrec : gripStepNormal;
}

function setSpeedMultiplier(newVal) {
  speedMult = clamp(newVal, SPEED_MIN, SPEED_MAX);
  motionStatus("Speed multiplier = " + speedMult.toFixed(2) + "x");
}

function incSpeed() { setSpeedMultiplier(speedMult + 0.25); }
function decSpeed() { setSpeedMultiplier(speedMult - 0.25); }

function setGripTarget(openVal) {
  grip.targetOpen = clamp(openVal, grip.min, grip.max);
  motionStatus("Grip target = " + grip.targetOpen.toFixed(2));
}

function addGripTarget(delta) {
  setGripTarget(grip.targetOpen + delta);
}

function savePose() {
  savedPoses.push({
    theta: [targetTheta[Base], targetTheta[LowerArm], targetTheta[UpperArm]],
    grip: grip.targetOpen
  });
  motionStatus("Saved pose #" + savedPoses.length);
}

function applyPose(pose) {
  setTargetAngle(Base, pose.theta[0]);
  setTargetAngle(LowerArm, pose.theta[1]);
  setTargetAngle(UpperArm, pose.theta[2]);
  setGripTarget(pose.grip);
}

function toggleRecordMode() {
  recordMode = !recordMode;
  motionStatus("Record Mode: " + (recordMode ? "ON" : "OFF"));
}

function startPlayMode() {
  if (savedPoses.length === 0) {
    motionStatus("Play Mode: no saved poses");
    return;
  }
  playMode = true;
  playIndex = 0;
  playHoldCounter = 0;
  applyPose(savedPoses[playIndex]);
  motionStatus("Play Mode: ON (loop)");
}

function stopPlayMode() {
  playMode = false;
  motionStatus("Play Mode: OFF");
}

// Call every frame to advance playback
function updatePlayback() {
  if (!playMode || savedPoses.length === 0) return;

  // When we reach the current pose, hold briefly, then advance.
  var allReached =
    Math.abs(theta[Base]     - targetTheta[Base])     < 0.1 &&
    Math.abs(theta[LowerArm] - targetTheta[LowerArm]) < 0.1 &&
    Math.abs(theta[UpperArm] - targetTheta[UpperArm]) < 0.1 &&
    Math.abs(grip.open - grip.targetOpen) < 0.01;

  if (allReached) {
    if (playHoldCounter < playHoldFrames) {
      playHoldCounter++;
      return;
    }
    playHoldCounter = 0;

    playIndex = (playIndex + 1) % savedPoses.length;
    applyPose(savedPoses[playIndex]);
    motionStatus("Play pose #" + (playIndex + 1));
  }
}


var MOTION_SCALE = 0.5; // cut all motion degrees in half

function setGripperTargetByPercent(percent0to100) {
  var p = clamp(percent0to100, 0, 100) / 100.0;
  grip.targetOpen = grip.min + p * (grip.max - grip.min);
  motionStatus(`Gripper target = ${grip.targetOpen.toFixed(2)} (gap)`);
}

function openGripper() {
  grip.targetOpen = grip.max;
  motionStatus("Gripper opening");
}

function closeGripper() {
  grip.targetOpen = grip.min;
  motionStatus("Gripper closing");
}

function toggleGripper() {
  var mid = (grip.min + grip.max) * 0.5;
  if (grip.open > mid) closeGripper();
  else openGripper();
}

// Set target angle with constraints + feedback
function setTargetAngle(jointIndex, valueDeg) {
  var lim = limitsForJoint(jointIndex);
  targetTheta[jointIndex] = clamp(valueDeg, lim.min, lim.max);
  motionStatus(`${nameOfJoint(jointIndex)} target = ${targetTheta[jointIndex]}°`);
}

// Increment target angle (keyboard uses this)
function addTargetAngle(jointIndex, deltaDeg) {
  setTargetAngle(jointIndex, targetTheta[jointIndex] + deltaDeg*MOTION_SCALE);
}

// Smoothly move current theta toward targetTheta
function updateSmoothAngles() {
  // joints
  for (var i = 0; i < 3; i++) {
    var diff = targetTheta[i] - theta[i];

    if (Math.abs(diff) < 0.05) {
      // If it just snapped, announce reached
      if (theta[i] !== targetTheta[i]) {
        theta[i] = targetTheta[i];
        motionStatus(`${nameOfJoint(i)} rotated to ${theta[i].toFixed(0)}°`);
      } else {
        theta[i] = targetTheta[i];
      }
    } else {
      theta[i] += diff * (smoothSpeed* speedMult);
    }
  }

  // gripper
  var gdiff = grip.targetOpen - grip.open;
  if (Math.abs(gdiff) < 0.005) {
    if (grip.open !== grip.targetOpen) {
      grip.open = grip.targetOpen;
      motionStatus(`Gripper set to ${grip.open.toFixed(2)} (gap)`);
    } else {
      grip.open = grip.targetOpen;
    }
  } else {
    grip.open += gdiff * (grip.smoothSpeed * speedMult);
  }

  // keep sliders synced to the *targets* (or current) so UI stays consistent
  var s1 = document.getElementById("slider1");
  var s2 = document.getElementById("slider2");
  var s3 = document.getElementById("slider3");

  if (s1) s1.value = Math.round(targetTheta[Base]);
  if (s2) s2.value = Math.round(targetTheta[LowerArm]);
  if (s3) s3.value = Math.round(targetTheta[UpperArm]);

  var s4 = document.getElementById("slider4");
  if (s4) {
    // map grip.open (min..max) -> 0..100
    var pct = ((grip.targetOpen - grip.min) / (grip.max - grip.min)) * 100;
    s4.value = clamp(pct, 0, 100);
  }
}


// Feedback ownership (console + optional HTML element)
function motionStatus(msg) {
  // Build a compact readable status line
  var line =
    msg + " | " +
    "Base " + theta[Base].toFixed(1) + "° (→ " + targetTheta[Base].toFixed(1) + "°), " +
    "Lower " + theta[LowerArm].toFixed(1) + "° (→ " + targetTheta[LowerArm].toFixed(1) + "°), " +
    "Upper " + theta[UpperArm].toFixed(1) + "° (→ " + targetTheta[UpperArm].toFixed(1) + "°), " +
    "Grip " + grip.open.toFixed(2) + " (→ " + grip.targetOpen.toFixed(2) + ")";

  console.log("[Motion]", line);

  var el = document.getElementById("status");
  if (el) el.textContent = line;
}

//--------------------------------------------------

function setInitialPose(baseDeg, lowerDeg, upperDeg, gripGap) {
  // Set both current + target so it doesn't animate from 0
  theta[Base] = targetTheta[Base] = baseDeg;
  theta[LowerArm] = targetTheta[LowerArm] = lowerDeg;
  theta[UpperArm] = targetTheta[UpperArm] = upperDeg;

  grip.open = grip.targetOpen = gripGap;

  // Sync sliders if they exist
  var s1 = document.getElementById("slider1");
  var s2 = document.getElementById("slider2");
  var s3 = document.getElementById("slider3");
  var s4 = document.getElementById("slider4");

  if (s1) s1.value = baseDeg;
  if (s2) s2.value = lowerDeg;
  if (s3) s3.value = upperDeg;

  if (s4) {
    // slider4 is 0..100, convert from gap to percent
    var pct = ((gripGap - grip.min) / (grip.max - grip.min)) * 100;
    s4.value = clamp(pct, 0, 100);
  }
}

//--------------------------------------------------


function init() {

    canvas = document.getElementById( "gl-canvas" );

    gl = canvas.getContext('webgl2');
    if (!gl) { alert( "WebGL 2.0 isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );

    gl.clearColor( 1.0, 1.0, 1.0, 1.0 );
    gl.enable( gl.DEPTH_TEST );

    //  Load shaders and initialize attribute buffers
    program = initShaders( gl, "vertex-shader", "fragment-shader" );

    gl.useProgram( program );

    buildCylinder(CYL_SLICES);
    console.log("NumVertices =", NumVertices);

    // Load shaders and use the resulting shader program

    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    // Create and initialize  buffer objects

    vBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW );

    var positionLoc = gl.getAttribLocation( program, "aPosition" );
    gl.vertexAttribPointer( positionLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( positionLoc );

    cBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, cBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW );

    var colorLoc = gl.getAttribLocation( program, "aColor" );
    gl.vertexAttribPointer( colorLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( colorLoc );

    document.getElementById("slider1").onchange = function(event) {
    setTargetAngle(Base, Number(event.target.value)*MOTION_SCALE);
    };
    document.getElementById("slider2").onchange = function(event) {
    setTargetAngle(LowerArm, Number(event.target.value)*MOTION_SCALE);
    };
    document.getElementById("slider3").onchange = function(event) {
    setTargetAngle(UpperArm, Number(event.target.value)*MOTION_SCALE);
    };
    document.getElementById("slider4").onchange = function(event) {
    setGripperTargetByPercent(Number(event.target.value));
    }


    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");

    projectionMatrix = ortho(-10, 10, -10, 10, -10, 10);
    gl.uniformMatrix4fv( gl.getUniformLocation(program, "projectionMatrix"),  false, flatten(projectionMatrix) );

    setInitialPose(75, 35, 90, 0.55);
    motionStatus("Lower Arm rotated to initial pose");

    render();
    
    window.addEventListener("keydown", function (e) {
    var k = e.key;

    // Keep precisionMode synced with CAPS LOCK
    isPrecisionNow(e);

    // Prevent spacebar scrolling the page
    if (e.key === " ") e.preventDefault();

    // Steps
    var baseStep = currentStepDeg(e, "base");
    var armStep  = currentStepDeg(e, "arm");
    var gStep    = currentGripStep(e);

    switch (k.toLowerCase()) {

      // Q,A -> Move base (per your spec)
      case "a": addTargetAngle(Base, +baseStep); break;
      case "d": addTargetAngle(Base, -baseStep); break;

      // W,S -> Move main arm (LowerArm)
      case "s": addTargetAngle(LowerArm, +armStep); break;
      case "w": addTargetAngle(LowerArm, -armStep); break;

      // F,R -> Move forearm (UpperArm)
      case "f": addTargetAngle(UpperArm, +armStep); break;
      case "r": addTargetAngle(UpperArm, -armStep); break;

      // O,P -> Move grip (open/close gap)
      // (O = open, P = close)
      case "o": addGripTarget(+gStep); motionStatus("Grip opening"); break;
      case "p": addGripTarget(-gStep); motionStatus("Grip closing"); break;

      // G -> Record Mode
      case "g": toggleRecordMode(); break;

      // X or Space -> Save a position (only if recordMode ON, if you want)
      case "x":
        if (!recordMode) { motionStatus("Record Mode is OFF (press G)"); break; }
        savePose();
        break;

      case " ":
        if (!recordMode) { motionStatus("Record Mode is OFF (press G)"); break; }
        savePose();
        break;

      // V -> Play mode loop
      case "v":
        if (playMode) stopPlayMode();
        else startPlayMode();
        break;

      // + / - -> speed
      case "+":
      case "=": // (shift+= often produces '+')
        incSpeed(); break;

      case "-":
      case "_":
        decSpeed(); break;
    }
  });

}

//----------------------------------------------------------------------------


function base() {
  // Main base body (wide + short)
  var mainS = scale(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH);
  var mainM = mult(translate(0.0, 0.5 * BASE_HEIGHT, 0.0), mainS);
  drawCubeWithMatrix(mainM); // (this draws your CYLINDER now)

  // Bevel parameters
  var bevelH = 0.25 * BASE_HEIGHT;
  var bevelScale = 0.88; // smaller radius to look rounded

  // Top bevel (slightly smaller cylinder on top)
  var topS = scale(BASE_WIDTH * bevelScale, bevelH, BASE_WIDTH * bevelScale);
  var topM = mat4();
  topM = mult(topM, translate(0.0, BASE_HEIGHT - 0.5 * bevelH, 0.0));
  topM = mult(topM, topS);
  drawCubeWithMatrix(topM);

  // Bottom bevel (slightly smaller cylinder at bottom)
  var botS = scale(BASE_WIDTH * bevelScale, bevelH, BASE_WIDTH * bevelScale);
  var botM = mat4();
  botM = mult(botM, translate(0.0, 0.5 * bevelH, 0.0));
  botM = mult(botM, botS);
  drawCubeWithMatrix(botM);
}


//----------------------------------------------------------------------------


function upperArm() {
    var s = scale(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH);

    var instanceMatrix = mult(translate( 0.0, 0.5 * UPPER_ARM_HEIGHT, 0.0 ),s);

    var t = mult(modelViewMatrix, instanceMatrix);

    gl.uniformMatrix4fv( modelViewMatrixLoc,  false, flatten(t)  );
    gl.drawArrays( gl.TRIANGLES, 0, NumVertices );
}

//----------------------------------------------------------------------------


function lowerArm()
{
  var s = scale(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH);
  var instanceMatrix = mult( translate( 0.0, 0.5 * LOWER_ARM_HEIGHT, 0.0 ), s);


  var t = mult(modelViewMatrix, instanceMatrix);
  gl.uniformMatrix4fv( modelViewMatrixLoc,  false, flatten(t)   );
  gl.drawArrays( gl.TRIANGLES, 0, NumVertices );

}

function drawCubeWithMatrix(instanceMatrix) {
  var t = mult(modelViewMatrix, instanceMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
  gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

// A nicer-looking claw: palm + 2-segment fingers with inward tips
function gripper() {
  // Attach at end of upper arm
  var saved = modelViewMatrix;
  modelViewMatrix = mult(modelViewMatrix, translate(0.0, UPPER_ARM_HEIGHT, 0.0));
  modelViewMatrix = mult(modelViewMatrix, rotate(-90, vec3(0, 1, 0)));
  

  // ---- Wrist / Palm block ----
  var PALM_W = 1.0;
  var PALM_H = 0.35;
  var PALM_D = 0.55;

  {
    var sPalm = scale(PALM_W, PALM_H, PALM_D);
    // center palm on the joint tip (slightly forward if you want)
    var palmM = mult(translate(0.0, 0.5 * PALM_H, 0.0), sPalm);
    drawCubeWithMatrix(palmM);
  }

  // ---- Finger parameters ----
  var F_W = 0.16;      // finger thickness
  var F_D = 0.16;      // finger depth
  var F1_L = 0.85;     // base segment length
  var F2_L = 0.65;     // tip segment length

  var GAP = grip.open;      // distance between left/right fingers
  var BASE_Y = PALM_H; // start fingers above palm
  var OUT_ANGLE = 10;  // small outward angle
  var IN_ANGLE  = 25;  // tip bends inward

  // helper to draw one finger (side = -1 left, +1 right)
  function finger(side) {
    // start at palm top, shifted left/right
    var fingerBase = mat4();
    fingerBase = mult(fingerBase, translate(side * (GAP * 0.5), BASE_Y, 0.0));

    // Base segment: slightly angled outward
    var baseRot = rotate(side * OUT_ANGLE, vec3(0, 0, 1));
    var baseSeg = mat4();
    baseSeg = mult(baseSeg, fingerBase);
    baseSeg = mult(baseSeg, baseRot);

    // draw base segment centered along its length
    {
      var s1 = scale(F_W, F1_L, F_D);
      var m1 = mult(baseSeg, translate(0.0, 0.5 * F1_L, 0.0));
      m1 = mult(m1, s1);
      drawCubeWithMatrix(m1);
    }

    // Tip segment: continue from end of base, bend inward
    var tipSeg = mat4();
    tipSeg = mult(tipSeg, baseSeg);
    tipSeg = mult(tipSeg, translate(0.0, F1_L, 0.0)); // move to end of base
    tipSeg = mult(tipSeg, rotate(-side * IN_ANGLE, vec3(0, 0, 1))); // bend inward

    {
      var s2 = scale(F_W, F2_L, F_D);
      var m2 = mult(tipSeg, translate(0.0, 0.5 * F2_L, 0.0));
      m2 = mult(m2, s2);
      drawCubeWithMatrix(m2);
    }
  }

  // draw both fingers
  finger(-1); // left
  finger(+1); // right

  modelViewMatrix = saved;
}


//----------------------------------------------------------------------------


function render() {

    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    updatePlayback();
    updateSmoothAngles();

    modelViewMatrix = rotate(theta[Base], vec3(0, 1, 0 ));
    base();

    modelViewMatrix = mult(modelViewMatrix, translate(0.0, BASE_HEIGHT, 0.0));
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[LowerArm], vec3(0, 0, 1 )));
    lowerArm();

    modelViewMatrix  = mult(modelViewMatrix, translate(0.0, LOWER_ARM_HEIGHT, 0.0));
    modelViewMatrix  = mult(modelViewMatrix, rotate(theta[UpperArm], vec3(0, 0, 1)) );

    upperArm();
    gripper();
    requestAnimationFrame(render);
}
