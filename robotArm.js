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

// Shader transformation matrices
var modelViewMatrix, projectionMatrix;

// Array of rotation angles (in degrees) for each rotation axis
var Base = 0;
var LowerArm = 1;
var UpperArm = 2;

// Current angles for each joint
var theta = [0, 0, 0];
// Target angles for each joint
var targetTheta = [0, 0, 0];

// ===== Gripper control (functional) =====
var grip = {
  open: 0.55,          // current gap (start open)
  targetOpen: 0.55,    // target gap
  min: 0.15,           // fully closed gap
  max: 0.75,           // fully open gap
  smoothSpeed: 0.12
};

// ===== OBJECT CONFIGURATION =====
var object = {
    position: {
        x: 5.0,  // Changed from 0.0 to 5.0 to match automation
        y: 0.5,
        z: 0.0   // Changed from 6.0 to 0.0
    },
    size: {
        width: 0.5,
        height: 0.5,
        depth: 0.5
    },
    color: {
        red: 1.0,
        green: 0.0,
        blue: 0.0,
        alpha: 1.0
    },
    isPicked: false
};

// Place position for the object (where to put it)
var placePosition = {
    x: -5.0,
    y: 0.5,
    z: 0.0
};

// Helper function to get object color
function getObjectColorVec() {
    return vec4(
        object.color.red,
        object.color.green,
        object.color.blue,
        object.color.alpha
    );
}

// Calculate actual gripper position in world space
function getGripperWorldPosition() {
    // Start from identity matrix
    var m = mat4();
    
    // IMPORTANT: Apply transformations in reverse order of how they're drawn
    
    // 1. Base rotation (Y axis)
    m = mult(m, rotate(theta[0], vec3(0, 1, 0)));
    
    // 2. Lower arm offset and rotation
    m = mult(m, translate(0.0, BASE_HEIGHT, 0.0));
    m = mult(m, rotate(theta[1], vec3(0, 0, 1)));
    
    // 3. Upper arm offset and rotation
    m = mult(m, translate(0.0, LOWER_ARM_HEIGHT, 0.0));
    m = mult(m, rotate(theta[2], vec3(0, 0, 1)));
    
    // 4. Move to end of upper arm (gripper attachment point)
    m = mult(m, translate(0.0, UPPER_ARM_HEIGHT, 0.0));
    
    // 5. Rotate gripper to face forward (depends on your gripper orientation)
    // Try different values here if this doesn't work:
    m = mult(m, rotate(-90, vec3(0, 1, 0)));
    
    // 6. Move to center of gripper jaws
    m = mult(m, translate(0.0, 0.2, 0.0));  // Adjust this value!
    
    // Return as array [x, y, z]
    return [m[0][3], m[1][3], m[2][3]];
}

function isGripperAtBox() {
    if (!object) return false;

    const gPos = getGripperWorldPosition();
    const bPos = object.position;

    const dx = gPos[0] - bPos.x;
    const dy = gPos[1] - bPos.y;
    const dz = gPos[2] - bPos.z;

    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

    console.log(
        "Gripper-Box distance:", distance.toFixed(3),
        "Gripper:", gPos.map(v => v.toFixed(2)),
        "Box:", bPos.x.toFixed(2), bPos.y.toFixed(2), bPos.z.toFixed(2)
    );

    return distance < 0.6;   // IMPORTANT: increased tolerance
}



// Simple object drawing function
function drawObject() {
    if (object.isPicked) return; // handled in gripper()

    var saved = modelViewMatrix;

    modelViewMatrix = mult(modelViewMatrix, translate(
        object.position.x,
        object.position.y,
        object.position.z
    ));

    modelViewMatrix = mult(modelViewMatrix, scale(
        object.size.width,
        object.size.height,
        object.size.depth
    ));

    drawColoredCube(getObjectColorVec());

    modelViewMatrix = saved;
}

// realistic pick detection
function isGripperNearObject() {
    // TEMPORARY: Always return true when at pick position
    if (Math.abs(theta[Base] - 0) < 5 && 
        Math.abs(theta[LowerArm] - 75) < 5 && 
        Math.abs(theta[UpperArm] - (-30)) < 5) {
        console.log("At pick position - assuming object is reachable");
        return true;
    }
    
    // Original distance calculation (for when position is fixed)
    var g = getGripperWorldPosition();
    var gx = g[0];
    var gy = g[1];
    var gz = g[2];
    
    var dx = gx - object.position.x;
    var dy = gy - object.position.y;
    var dz = gz - object.position.z;

    var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    console.log("Distance to object:", dist.toFixed(2));
    return dist < 2.0; // Increased tolerance
}

// Check if arm is at target position
function isArmAtTarget() {
    const tolerance = 1.0; // degrees tolerance
    return Math.abs(theta[Base] - targetTheta[Base]) < tolerance &&
           Math.abs(theta[LowerArm] - targetTheta[LowerArm]) < tolerance &&
           Math.abs(theta[UpperArm] - targetTheta[UpperArm]) < tolerance;
}


// Function to draw a colored cube
function drawColoredCube(color) {
    // Create cube vertices
    var cubeVertices = [
        // Front face
        vec4(-0.5, -0.5,  0.5, 1.0),
        vec4( 0.5, -0.5,  0.5, 1.0),
        vec4( 0.5,  0.5,  0.5, 1.0),
        vec4(-0.5,  0.5,  0.5, 1.0),
        // Back face
        vec4(-0.5, -0.5, -0.5, 1.0),
        vec4(-0.5,  0.5, -0.5, 1.0),
        vec4( 0.5,  0.5, -0.5, 1.0),
        vec4( 0.5, -0.5, -0.5, 1.0),
        // Top face
        vec4(-0.5,  0.5, -0.5, 1.0),
        vec4(-0.5,  0.5,  0.5, 1.0),
        vec4( 0.5,  0.5,  0.5, 1.0),
        vec4( 0.5,  0.5, -0.5, 1.0),
        // Bottom face
        vec4(-0.5, -0.5, -0.5, 1.0),
        vec4( 0.5, -0.5, -0.5, 1.0),
        vec4( 0.5, -0.5,  0.5, 1.0),
        vec4(-0.5, -0.5,  0.5, 1.0),
        // Right face
        vec4( 0.5, -0.5, -0.5, 1.0),
        vec4( 0.5,  0.5, -0.5, 1.0),
        vec4( 0.5,  0.5,  0.5, 1.0),
        vec4( 0.5, -0.5,  0.5, 1.0),
        // Left face
        vec4(-0.5, -0.5, -0.5, 1.0),
        vec4(-0.5, -0.5,  0.5, 1.0),
        vec4(-0.5,  0.5,  0.5, 1.0),
        vec4(-0.5,  0.5, -0.5, 1.0)
    ];
    
    // Create triangle indices for cube
    var cubeIndices = [
        0, 1, 2, 0, 2, 3,    // front
        4, 5, 6, 4, 6, 7,    // back
        8, 9, 10, 8, 10, 11,  // top
        12, 13, 14, 12, 14, 15, // bottom
        16, 17, 18, 16, 18, 19, // right
        20, 21, 22, 20, 22, 23  // left
    ];
    
    // Build final arrays
    var finalVertices = [];
    var finalColors = [];
    
    for (var i = 0; i < cubeIndices.length; i++) {
        finalVertices.push(cubeVertices[cubeIndices[i]]);
        finalColors.push(color);
    }
    
    // Save current buffer bindings
    var originalVBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    
    // Create and bind vertex buffer
    var tempVBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tempVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(finalVertices), gl.STATIC_DRAW);
    
    var positionLoc = gl.getAttribLocation(program, "aPosition");
    gl.vertexAttribPointer(positionLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLoc);
    
    // Create and bind color buffer
    var tempCBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tempCBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(finalColors), gl.STATIC_DRAW);
    
    var colorLoc = gl.getAttribLocation(program, "aColor");
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(colorLoc);
    
    // Draw the cube
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(modelViewMatrix));
    gl.drawArrays(gl.TRIANGLES, 0, finalVertices.length);
    
    // Restore original buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.vertexAttribPointer(positionLoc, 4, gl.FLOAT, false, 0, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    
    // Restore original buffer binding if it existed
    if (originalVBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, originalVBuffer);
    }
}

var step = 10;
var smoothSpeed = 0.15;

// ===== Key mapping settings =====
var precisionMode = false;
var baseStepNormal = 10;
var baseStepPrec   = 1;
var armStepNormal  = 10;
var armStepPrec    = 1;
var gripStepNormal = 0.08;
var gripStepPrec   = 0.02;

// Speed scaling (+ / -)
var speedMult = 1.0;
var SPEED_MIN = 0.25;
var SPEED_MAX = 3.0;

// Record / playback
var recordMode = false;
var playMode = false;
var savedPoses = [];
var playIndex = 0;
var playHoldFrames = 10;
var playHoldCounter = 0;

// Joint angle limits
var LIMITS = {
    base: { min: -180, max: 180 },
    lowerArm: { min: -150, max: 150 },
    upperArm: { min: -150, max: 150 }
};

var gripperAutomation = null;
var modelViewMatrixLoc;
var vBuffer, cBuffer;

window.onload = init;

//----------------------------------------------------------------------------

function buildCylinder(slices) {
  points = [];
  colors = [];

  var r = 0.5;
  var yTop = 0.5;
  var yBot = -0.5;

  var topCenter = vec4(0, yTop, 0, 1);
  var botCenter = vec4(0, yBot, 0, 1);

  function ringVertex(theta, y) {
    return vec4(r * Math.cos(theta), y, r * Math.sin(theta), 1);
  }

  var sideColor = vec4(0.2, 0.2, 0.8, 1.0);
  var capColor  = vec4(0.8, 0.8, 0.0, 1.0);

  for (var i = 0; i < slices; i++) {
    var a0 = (i / slices) * 2 * Math.PI;
    var a1 = ((i + 1) / slices) * 2 * Math.PI;

    var v0 = ringVertex(a0, yBot);
    var v1 = ringVertex(a1, yBot);
    var v2 = ringVertex(a1, yTop);
    var v3 = ringVertex(a0, yTop);

    // Side (2 triangles)
    colors.push(sideColor); points.push(v0);
    colors.push(sideColor); points.push(v1);
    colors.push(sideColor); points.push(v2);

    colors.push(sideColor); points.push(v0);
    colors.push(sideColor); points.push(v2);
    colors.push(sideColor); points.push(v3);

    // Top cap (1 triangle)
    colors.push(capColor); points.push(topCenter);
    colors.push(capColor); points.push(v3);
    colors.push(capColor); points.push(v2);

    // Bottom cap (1 triangle)
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

function updatePlayback() {
  if (!playMode || savedPoses.length === 0) return;

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

var MOTION_SCALE = 0.5;

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
            theta[i] = targetTheta[i]; // snap to target
        } else {
            theta[i] += diff * (smoothSpeed * speedMult);
        }
    }

    // gripper
    var gdiff = grip.targetOpen - grip.open;
    if (Math.abs(gdiff) < 0.005) {
        grip.open = grip.targetOpen;
    } else {
        grip.open += gdiff * (grip.smoothSpeed * speedMult);
    }

    // keep sliders synced
    var s1 = document.getElementById("slider1");
    var s2 = document.getElementById("slider2");
    var s3 = document.getElementById("slider3");
    var s4 = document.getElementById("slider4");

    if (s1) s1.value = Math.round(targetTheta[Base]);
    if (s2) s2.value = Math.round(targetTheta[LowerArm]);
    if (s3) s3.value = Math.round(targetTheta[UpperArm]);
    if (s4) {
        var pct = ((grip.targetOpen - grip.min) / (grip.max - grip.min)) * 100;
        s4.value = clamp(pct, 0, 100);
    }
}

// Feedback ownership (console + optional HTML element)
function motionStatus(msg) {
  var line = msg + " | Base: " + theta[Base].toFixed(1) + "° Lower: " + 
            theta[LowerArm].toFixed(1) + "° Upper: " + theta[UpperArm].toFixed(1) + "°";

  console.log("[Motion]", line);

  var el = document.getElementById("status");
  if (el) el.textContent = line;
}

function setInitialPose(baseDeg, lowerDeg, upperDeg, gripGap) {
  theta[Base] = targetTheta[Base] = baseDeg;
  theta[LowerArm] = targetTheta[LowerArm] = lowerDeg;
  theta[UpperArm] = targetTheta[UpperArm] = upperDeg;

  grip.open = grip.targetOpen = gripGap;

  var s1 = document.getElementById("slider1");
  var s2 = document.getElementById("slider2");
  var s3 = document.getElementById("slider3");
  var s4 = document.getElementById("slider4");

  if (s1) s1.value = baseDeg;
  if (s2) s2.value = lowerDeg;
  if (s3) s3.value = upperDeg;

  if (s4) {
    var pct = ((gripGap - grip.min) / (grip.max - grip.min)) * 100;
    s4.value = clamp(pct, 0, 100);
  }
}

function init() {
    try {
        canvas = document.getElementById("gl-canvas");
        
        if (!canvas) {
            alert("Canvas element not found!");
            return;
        }

        gl = canvas.getContext('webgl2');
        if (!gl) { 
            alert("WebGL 2.0 isn't available"); 
            return;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(1.0, 1.0, 1.0, 1.0);
        gl.enable(gl.DEPTH_TEST);

        // Load shaders
        program = initShaders(gl, "vertex-shader", "fragment-shader");
        if (!program) {
            alert("Failed to initialize shaders");
            return;
        }
        
        gl.useProgram(program);

        // Build cylinder geometry
        buildCylinder(CYL_SLICES);
        console.log("NumVertices =", NumVertices);

        // Create and initialize buffer objects
        vBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);

        var positionLoc = gl.getAttribLocation(program, "aPosition");
        if (positionLoc < 0) {
            console.error("Could not find aPosition attribute");
        }
        gl.vertexAttribPointer(positionLoc, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(positionLoc);

        cBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW);

        var colorLoc = gl.getAttribLocation(program, "aColor");
        if (colorLoc < 0) {
            console.error("Could not find aColor attribute");
        }
        gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);

        // Set up slider event handlers
        var slider1 = document.getElementById("slider1");
        var slider2 = document.getElementById("slider2");
        var slider3 = document.getElementById("slider3");
        var slider4 = document.getElementById("slider4");
        
        if (slider1) slider1.onchange = function(event) {
            setTargetAngle(Base, Number(event.target.value)*MOTION_SCALE);
        };
        if (slider2) slider2.onchange = function(event) {
            setTargetAngle(LowerArm, Number(event.target.value)*MOTION_SCALE);
        };
        if (slider3) slider3.onchange = function(event) {
            setTargetAngle(UpperArm, Number(event.target.value)*MOTION_SCALE);
        };
        if (slider4) slider4.onchange = function(event) {
            setGripperTargetByPercent(Number(event.target.value));
        };

        modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
        if (!modelViewMatrixLoc) {
            console.error("Could not find modelViewMatrix uniform");
        }

        projectionMatrix = ortho(-10, 10, -10, 10, -10, 10);
        var projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
        if (projectionMatrixLoc) {
            gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));
        }

        // Initialize modelViewMatrix
        modelViewMatrix = mat4();
        
        setInitialPose(75, 35, 90, 0.55);
        motionStatus("Robot Arm Initialized");
        
        // Initialize automation with proper arm controls
        if (typeof GripperAutomation !== 'undefined') {
            var armControls = {
                setTargetAngle: setTargetAngle,
                setGripTarget: setGripTarget,
                motionStatus: motionStatus,
                Base: Base,
                LowerArm: LowerArm,
                UpperArm: UpperArm,
                theta: theta,
                targetTheta: targetTheta,
                grip: grip,
                object: object,
                placePosition: placePosition,
                isArmAtTarget: isArmAtTarget,  // Added this function
                getGripperWorldPosition: getGripperWorldPosition  // Added this function
            };

            gripperAutomation = new GripperAutomation(armControls);

            // Update automation UI every 100ms
            setInterval(function() {
                if (gripperAutomation) {
                    gripperAutomation.updateUI();
                }
            }, 100);
        } else {
            console.log("GripperAutomation not loaded yet");
        }
        
        // Start rendering
        render();
        
        // Keyboard event handler
        window.addEventListener("keydown", function (e) {
            var k = e.key.toLowerCase();

            // Keep precisionMode synced with CAPS LOCK
            isPrecisionNow(e);

            // Prevent spacebar scrolling the page
            if (e.key === " ") e.preventDefault();

            // Steps
            var baseStep = currentStepDeg(e, "base");
            var armStep  = currentStepDeg(e, "arm");
            var gStep    = currentGripStep(e);

            switch (k) {
                // Base rotation
                case "a": addTargetAngle(Base, +baseStep); break;
                case "d": addTargetAngle(Base, -baseStep); break;

                // Lower arm
                case "s": addTargetAngle(LowerArm, +armStep); break;
                case "w": addTargetAngle(LowerArm, -armStep); break;

                // Upper arm
                case "f": addTargetAngle(UpperArm, +armStep); break;
                case "r": addTargetAngle(UpperArm, -armStep); break;

                // Gripper
                case "o": addGripTarget(+gStep); motionStatus("Grip opening"); break;
                case "p": addGripTarget(-gStep); motionStatus("Grip closing"); break;

                // Record/Playback
                case "g": toggleRecordMode(); break;
                case "x":
                    if (!recordMode) { motionStatus("Record Mode is OFF (press G)"); break; }
                    savePose();
                    break;
                case " ":
                    if (!recordMode) { motionStatus("Record Mode is OFF (press G)"); break; }
                    savePose();
                    break;
                case "v":
                    if (playMode) stopPlayMode();
                    else startPlayMode();
                    break;

                // Speed control
                case "+":
                case "=": incSpeed(); break;
                case "-":
                case "_": decSpeed(); break;
                    
                // Automation controls
                case "1": // Start automation
                    if (gripperAutomation) gripperAutomation.startPickAndPlace();
                    break;
                case "2": // Stop automation
                    if (gripperAutomation) gripperAutomation.stopAutomation();
                    break;
                case "3": // Reset arm
                    if (gripperAutomation) gripperAutomation.resetArm();
                    break;
                case "4": // Open gripper
                    if (gripperAutomation) gripperAutomation.openGripper();
                    break;
                case "5": // Close gripper
                    if (gripperAutomation) gripperAutomation.closeGripper();
                    break;
                case "6":
                    if (!object.isPicked) {
                        // Manual pick
                        object.isPicked = true;
                        if (gripperAutomation) gripperAutomation.gripState.holdingObject = false; // prevent automation
                        motionStatus("Manual pick: attached to gripper");
                    } else {
                        // Manual release
                        object.isPicked = false;
                        var dropPos = getGripperWorldPosition();
                        object.position.x = dropPos[0];
                        object.position.y = dropPos[1];
                        object.position.z = dropPos[2];
                        motionStatus("Manual release: dropped at gripper position");
                    }
                    break;
            }
        });
        
        console.log("Robot arm initialized successfully");
        
    } catch (error) {
        console.error("Error in init:", error);
        motionStatus("Initialization error: " + error.message);
    }
}

//----------------------------------------------------------------------------

function base() {
  // Main base body
  var mainS = scale(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH);
  var mainM = mult(translate(0.0, 0.5 * BASE_HEIGHT, 0.0), mainS);
  drawCubeWithMatrix(mainM);

  // Bevel parameters
  var bevelH = 0.25 * BASE_HEIGHT;
  var bevelScale = 0.88;

  // Top bevel
  var topS = scale(BASE_WIDTH * bevelScale, bevelH, BASE_WIDTH * bevelScale);
  var topM = mat4();
  topM = mult(topM, translate(0.0, BASE_HEIGHT - 0.5 * bevelH, 0.0));
  topM = mult(topM, topS);
  drawCubeWithMatrix(topM);

  // Bottom bevel
  var botS = scale(BASE_WIDTH * bevelScale, bevelH, BASE_WIDTH * bevelScale);
  var botM = mat4();
  botM = mult(botM, translate(0.0, 0.5 * bevelH, 0.0));
  botM = mult(botM, botS);
  drawCubeWithMatrix(botM);
}

function upperArm() {
    var s = scale(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH);
    var instanceMatrix = mult(translate(0.0, 0.5 * UPPER_ARM_HEIGHT, 0.0), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function lowerArm() {
  var s = scale(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH);
  var instanceMatrix = mult(translate(0.0, 0.5 * LOWER_ARM_HEIGHT, 0.0), s);
  var t = mult(modelViewMatrix, instanceMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
  gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function drawCubeWithMatrix(instanceMatrix) {
  var t = mult(modelViewMatrix, instanceMatrix);
  gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
  gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function gripper() {
  // Attach at end of upper arm
  var saved = modelViewMatrix;
  modelViewMatrix = mult(modelViewMatrix, translate(0.0, UPPER_ARM_HEIGHT, 0.0));
  modelViewMatrix = mult(modelViewMatrix, rotate(-90, vec3(0, 1, 0)));
  
  // Palm block
  var PALM_W = 1.0;
  var PALM_H = 0.35;
  var PALM_D = 0.55;

  {
    var sPalm = scale(PALM_W, PALM_H, PALM_D);
    var palmM = mult(translate(0.0, 0.5 * PALM_H, 0.0), sPalm);
    drawCubeWithMatrix(palmM);
  }

  // Finger parameters
  var F_W = 0.16;
  var F_D = 0.16;
  var F1_L = 0.85;
  var F2_L = 0.65;

  var GAP = grip.open;
  var BASE_Y = PALM_H;
  var OUT_ANGLE = 10;
  var IN_ANGLE  = 25;

  // helper to draw one finger
  function finger(side) {
    var fingerBase = mat4();
    fingerBase = mult(fingerBase, translate(side * (GAP * 0.5), BASE_Y, 0.0));
    var baseRot = rotate(side * OUT_ANGLE, vec3(0, 0, 1));
    var baseSeg = mat4();
    baseSeg = mult(baseSeg, fingerBase);
    baseSeg = mult(baseSeg, baseRot);

    // Base segment
    {
      var s1 = scale(F_W, F1_L, F_D);
      var m1 = mult(baseSeg, translate(0.0, 0.5 * F1_L, 0.0));
      m1 = mult(m1, s1);
      drawCubeWithMatrix(m1);
    }

    // Tip segment
    var tipSeg = mat4();
    tipSeg = mult(tipSeg, baseSeg);
    tipSeg = mult(tipSeg, translate(0.0, F1_L, 0.0));
    tipSeg = mult(tipSeg, rotate(-side * IN_ANGLE, vec3(0, 0, 1)));

    {
      var s2 = scale(F_W, F2_L, F_D);
      var m2 = mult(tipSeg, translate(0.0, 0.5 * F2_L, 0.0));
      m2 = mult(m2, s2);
      drawCubeWithMatrix(m2);
    }
  }

  // draw both fingers
  finger(-1);
  finger(+1);

  if (object.isPicked) {
    var saved2 = modelViewMatrix;

    // Move to center between fingers
    modelViewMatrix = mult(modelViewMatrix, translate(0.0, 0.8, 0.1));

    modelViewMatrix = mult(modelViewMatrix, scale(
        object.size.width,
        object.size.height,
        object.size.depth
    ));

    drawColoredCube(getObjectColorVec());

    modelViewMatrix = saved2;
  }

  modelViewMatrix = saved;
}

function render() {
    try {
        // Clear the canvas
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Update playback if needed
        updatePlayback();

        // Smoothly update joint angles and gripper
        updateSmoothAngles();

        // Update automation steps (pick/place)
        if (gripperAutomation) {
            gripperAutomation.update();
        }

        // Initialize modelViewMatrix if not already done
        if (!modelViewMatrix) {
            modelViewMatrix = mat4();
        }

        // Save current matrix for object drawing
        var originalMatrix = modelViewMatrix;

        // -------------------------
        // DRAW OBJECT FIRST (world space)
        // -------------------------
        drawObject();

        // Reset modelViewMatrix for robot arm
        modelViewMatrix = mat4();

        // -------------------------
        // DRAW ROBOT ARM
        // -------------------------

        // Base rotation
        modelViewMatrix = rotate(theta[Base], vec3(0, 1, 0));
        base();

        // Lower arm
        modelViewMatrix = mult(modelViewMatrix, translate(0.0, BASE_HEIGHT, 0.0));
        modelViewMatrix = mult(modelViewMatrix, rotate(theta[LowerArm], vec3(0, 0, 1)));
        lowerArm();

        // Upper arm
        modelViewMatrix = mult(modelViewMatrix, translate(0.0, LOWER_ARM_HEIGHT, 0.0));
        modelViewMatrix = mult(modelViewMatrix, rotate(theta[UpperArm], vec3(0, 0, 1)));
        upperArm();

        // Gripper
        gripper();

        // -------------------------
        // Restore original matrix
        // -------------------------
        modelViewMatrix = originalMatrix;

        // Continue animation loop
        requestAnimationFrame(render);

    } catch (error) {
        console.error("Error in render:", error);

        // Attempt to recover
        modelViewMatrix = mat4();
        motionStatus("Render error: " + error.message);

        // Continue rendering even after error
        requestAnimationFrame(render);
    }
}