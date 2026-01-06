// autoAnimation.js - Gripper & Automation Module (ES5 Compatible)
"use strict";

// Constructor function (ES5 style)
function GripperAutomation(armControls) {
    // Store references to main arm controls
    this.arm = armControls;
    
    // Automation state
    this.automation = {
        active: false,
        state: "idle", // "idle", "moving_to_pick", "grasping", "lifting", "moving_to_place", "releasing", "returning"
        step: 0,
        routineSteps: [],
        pickPosition: { base: 75, lower: -15, upper: 90 },
        placePosition: { base: -75, lower: -15, upper: 90 },
        liftAmount: 15, // degrees to lift after grasping
        delayBetweenSteps: 300 // ms
    };
    
    // Gripper state
    this.gripState = {
        state: "open",
        holdingObject: false
    };
    
    // Define the routine
    this.definePickAndPlaceRoutine();
}

// ===== GRIPPER FUNCTIONS =====

GripperAutomation.prototype.openGripper = function() {
    this.arm.setGripTarget(this.arm.grip.max);
    this.gripState.state = "opening";
    this.arm.motionStatus("Gripper opening...");
};

GripperAutomation.prototype.closeGripper = function() {
    this.arm.setGripTarget(this.arm.grip.min);
    this.gripState.state = "closing";
    this.arm.motionStatus("Gripper closing...");
};

GripperAutomation.prototype.updateGripperState = function() {
    var grip = this.arm.grip;
    if (Math.abs(grip.open - grip.targetOpen) < 0.01) {
        if (grip.targetOpen === grip.max) {
            this.gripState.state = "open";
            this.gripState.holdingObject = false;
            this.arm.motionStatus("Gripper fully open");
        } else if (grip.targetOpen === grip.min) {
            this.gripState.state = "closed";
            this.arm.motionStatus("Gripper fully closed" + (this.gripState.holdingObject ? " (object grasped)" : ""));
        }
    }
};

// ===== AUTOMATION ROUTINE =====

GripperAutomation.prototype.definePickAndPlaceRoutine = function() {
    this.automation.routineSteps = [
        { type: "move", target: this.automation.pickPosition, desc: "Moving to pick position" },
        { type: "grasp", desc: "Grasping object" },
        { type: "lift", amount: this.automation.liftAmount, desc: "Lifting object" },
        { type: "move", target: this.automation.placePosition, desc: "Moving to place position" },
        { type: "release", desc: "Releasing object" },
        { type: "lift", amount: -this.automation.liftAmount, desc: "Lowering gripper" },
        { type: "move", target: { base: 75, lower: 35, upper: 90 }, desc: "Returning to home" }
    ];
};

GripperAutomation.prototype.startPickAndPlace = function() {
    if (this.automation.active) {
        this.arm.motionStatus("Automation already running");
        return;
    }
    
    this.automation.active = true;
    this.automation.state = "moving_to_pick";
    this.automation.step = 0;
    this.gripState.holdingObject = false;
    
    this.arm.motionStatus("=== STARTING PICK-AND-PLACE ROUTINE ===");
    this.executeNextStep();
};

GripperAutomation.prototype.stopAutomation = function() {
    this.automation.active = false;
    this.automation.state = "idle";
    this.arm.motionStatus("Automation stopped");
};

GripperAutomation.prototype.resetArm = function() {
    this.stopAutomation();
    this.arm.setTargetAngle(this.arm.Base, 75);
    this.arm.setTargetAngle(this.arm.LowerArm, 35);
    this.arm.setTargetAngle(this.arm.UpperArm, 90);
    this.openGripper();
    this.gripState.holdingObject = false;
    this.arm.motionStatus("Arm reset to home position");
};

GripperAutomation.prototype.executeNextStep = function() {
    if (!this.automation.active || this.automation.step >= this.automation.routineSteps.length) {
        if (this.automation.active) {
            this.arm.motionStatus("=== PICK-AND-PLACE ROUTINE COMPLETED! ===");
            this.automation.active = false;
            this.automation.state = "idle";
        }
        return;
    }
    
    var currentStep = this.automation.routineSteps[this.automation.step];
    this.automation.state = currentStep.type;
    
    this.arm.motionStatus("[Step " + (this.automation.step + 1) + "/" + this.automation.routineSteps.length + "] " + currentStep.desc);
    
    var self = this; // Store reference for callbacks
    
    switch (currentStep.type) {
        case "move":
            this.arm.setTargetAngle(this.arm.Base, currentStep.target.base);
            this.arm.setTargetAngle(this.arm.LowerArm, currentStep.target.lower);
            this.arm.setTargetAngle(this.arm.UpperArm, currentStep.target.upper);
            this.waitForMovementThenNext();
            break;
            
        case "grasp":
            this.closeGripper();
            setTimeout(function() {
                self.gripState.holdingObject = true;
                self.arm.motionStatus("✓ Object grasped successfully");
                self.automation.step++;
                self.executeNextStep();
            }, 800);
            break;
            
        case "lift":
            var currentLower = this.arm.targetTheta[this.arm.LowerArm];
            this.arm.setTargetAngle(this.arm.LowerArm, currentLower + currentStep.amount);
            this.waitForMovementThenNext();
            break;
            
        case "release":
            this.openGripper();
            setTimeout(function() {
                self.gripState.holdingObject = false;
                self.arm.motionStatus("✓ Object released");
                self.automation.step++;
                self.executeNextStep();
            }, 800);
            break;
    }
};

GripperAutomation.prototype.waitForMovementThenNext = function() {
    var self = this;
    var checkInterval = setInterval(function() {
        var movementComplete = 
            Math.abs(self.arm.theta[self.arm.Base] - self.arm.targetTheta[self.arm.Base]) < 1 &&
            Math.abs(self.arm.theta[self.arm.LowerArm] - self.arm.targetTheta[self.arm.LowerArm]) < 1 &&
            Math.abs(self.arm.theta[self.arm.UpperArm] - self.arm.targetTheta[self.arm.UpperArm]) < 1;
        
        if (movementComplete) {
            clearInterval(checkInterval);
            self.automation.step++;
            setTimeout(function() {
                self.executeNextStep();
            }, self.automation.delayBetweenSteps);
        }
    }, 100);
};

// ===== UPDATE & STATUS =====

GripperAutomation.prototype.update = function() {
    this.updateGripperState();
};

GripperAutomation.prototype.getStatus = function() {
    return {
        automationState: this.automation.state,
        gripperState: this.gripState.state,
        holdingObject: this.gripState.holdingObject,
        step: this.automation.step + 1,
        totalSteps: this.automation.routineSteps.length,
        active: this.automation.active
    };
};

// ===== UI HELPER FUNCTIONS =====

GripperAutomation.prototype.updateUI = function() {
    var status = this.getStatus();
    
    // Update automation status display
    var autoStateEl = document.getElementById("auto-state");
    var gripperStateEl = document.getElementById("gripper-state");
    var holdingStateEl = document.getElementById("holding-state");
    var stepStateEl = document.getElementById("step-state");
    
    if (autoStateEl) autoStateEl.textContent = status.automationState;
    if (gripperStateEl) gripperStateEl.textContent = status.gripperState;
    if (holdingStateEl) holdingStateEl.textContent = status.holdingObject ? "Yes" : "No";
    if (stepStateEl) {
        stepStateEl.textContent = status.active ? 
            "Step " + status.step + "/" + status.totalSteps : "Idle";
    }
    
    // Update button states
    var startBtn = document.getElementById("start-auto-btn");
    var stopBtn = document.getElementById("stop-auto-btn");
    var resetBtn = document.getElementById("reset-arm-btn");
    
    if (startBtn) startBtn.disabled = status.active;
    if (stopBtn) stopBtn.disabled = !status.active;
    if (resetBtn) resetBtn.disabled = status.active;
};

// Make sure the class is available globally
if (typeof window !== 'undefined') {
    window.GripperAutomation = GripperAutomation;
}

// Debug message
console.log("autoAnimation.js loaded - GripperAutomation available:", typeof GripperAutomation);