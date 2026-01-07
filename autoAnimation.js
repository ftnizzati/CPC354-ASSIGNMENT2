"use strict";

// Constructor function
function GripperAutomation(armControls) {
    this.arm = armControls;

    this.automation = {
        active: false,
        state: "idle",
        step: 0,
        routineSteps: [],
        pickPosition: { base: 0, lower: 75, upper: -30 },
        placePosition: { base: 180, lower: 75, upper: -30 },
        liftPosition: { base: 0, lower: 45, upper: 0 },
        delayBetweenSteps: 500
    };

    this.gripState = {
        state: "open",
        holdingObject: false
    };

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

// ===== AUTOMATION ROUTINE =====

GripperAutomation.prototype.definePickAndPlaceRoutine = function() {
    this.automation.routineSteps = [
        { type: "move", target: this.automation.pickPosition, desc: "Moving to pick position" },
        { type: "grasp", desc: "Grasping object" },
        { type: "move", target: this.automation.liftPosition, desc: "Lifting object" },
        { type: "move", target: this.automation.placePosition, desc: "Moving to place position" },
        { type: "release", desc: "Releasing object" },
        { type: "move", target: { base: 0, lower: 35, upper: 45 }, desc: "Returning to home" }
    ];
};

GripperAutomation.prototype.startPickAndPlace = function() {
    console.log("DEBUG: startPickAndPlace called");
    
    if (this.automation.active) {
        this.arm.motionStatus("Automation already running");
        return;
    }

    this.automation.active = true;
    this.automation.step = 0;
    this.automation.state = "starting";
    this.gripState.holdingObject = false;

    console.log("DEBUG: Automation state reset, step=" + this.automation.step);

    if (this.arm.object) {
        this.arm.object.isPicked = false;
        this.arm.object.position.x = 5.0;
        this.arm.object.position.y = 0.5;
        this.arm.object.position.z = 0.0;
        console.log("DEBUG: Object reset to pick position");
    }

    this.openGripper();
    this.arm.motionStatus("=== STARTING PICK-AND-PLACE ROUTINE ===");

    var self = this;
    setTimeout(function() {
        console.log("DEBUG: Executing first step after timeout");
        self.executeNextStep();
    }, 1000);
};

GripperAutomation.prototype.stopAutomation = function() {
    this.automation.active = false;
    this.automation.state = "idle";
    this.arm.motionStatus("Automation stopped");
};

GripperAutomation.prototype.resetArm = function() {
    this.stopAutomation();
    this.arm.setTargetAngle(this.arm.Base, 0);
    this.arm.setTargetAngle(this.arm.LowerArm, 35);
    this.arm.setTargetAngle(this.arm.UpperArm, 45);
    this.openGripper();
    this.gripState.holdingObject = false;

    if (this.arm.object) {
        this.arm.object.isPicked = false;
        this.arm.object.position.x = 5.0;
        this.arm.object.position.y = 0.5;
        this.arm.object.position.z = 0.0;
    }

    this.arm.motionStatus("Arm reset to home position");
};

// ===== STEP EXECUTION =====

GripperAutomation.prototype.executeNextStep = function() {
    console.log("DEBUG =====================");
    console.log("executeNextStep called - step:", this.automation.step);
    console.log("Active:", this.automation.active);
    console.log("Total steps:", this.automation.routineSteps.length);
    
    if (!this.automation.active) {
        console.log("DEBUG: Automation not active, stopping");
        return;
    }
    
    if (this.automation.step >= this.automation.routineSteps.length) {
        console.log("DEBUG: All steps completed!");
        this.automation.active = false;
        this.automation.state = "idle";
        this.arm.motionStatus("=== PICK-AND-PLACE ROUTINE COMPLETED! ===");
        return;
    }

    var step = this.automation.routineSteps[this.automation.step];
    console.log("DEBUG: Current step type:", step.type, "desc:", step.desc);
    
    this.automation.state = step.type;
    this.arm.motionStatus("[Step " + (this.automation.step + 1) + "/" + this.automation.routineSteps.length + "] " + step.desc);

    var self = this;

    switch(step.type) {
        case "move":
            console.log("DEBUG: Setting target angles:");
            console.log("Base:", step.target.base);
            console.log("Lower:", step.target.lower);
            console.log("Upper:", step.target.upper);
            
            this.arm.targetTheta[this.arm.Base] = step.target.base;
            this.arm.targetTheta[this.arm.LowerArm] = step.target.lower;
            this.arm.targetTheta[this.arm.UpperArm] = step.target.upper;
            
            console.log("DEBUG: Target angles set, waiting for movement...");
            this.waitForMovementThenNext();
            break;

        case "grasp":
            console.log("DEBUG: Closing gripper for grasp");
            this.closeGripper();
            setTimeout(function() {
                // Assume grasp worked after delay
                self.gripState.holdingObject = true;
                self.gripState.state = "closed";
                if (self.arm.object) {
                    self.arm.object.isPicked = true;
                    console.log("DEBUG: Object marked as picked");
                }
                self.arm.motionStatus("✓ Object successfully grasped");
                self.automation.step++;
                setTimeout(function() {
                    self.executeNextStep();
                }, 500);
            }, 1000);
            break;

        case "release":
            console.log("DEBUG: Opening gripper for release");
            this.openGripper();
            setTimeout(function() {
                if (self.arm.object) {
                    self.arm.object.isPicked = false;
                    // Set object at place position
                    self.arm.object.position.x = -5.0; // place position x
                    self.arm.object.position.y = 0.5;
                    self.arm.object.position.z = 0.0;
                    console.log("DEBUG: Object released at place position");
                }
                self.gripState.holdingObject = false;
                self.gripState.state = "open";
                self.arm.motionStatus("✓ Object released at place position");
                self.automation.step++;
                setTimeout(function() {
                    self.executeNextStep();
                }, 500);
            }, 1000);
            break;
    }
};

GripperAutomation.prototype.waitForMovementThenNext = function() {
    var self = this;
    var startTime = Date.now();
    var timeout = 10000; // 10 second timeout
    var checkCount = 0;
    
    console.log("DEBUG: waitForMovementThenNext called for step", this.automation.step);
    
    var checkInterval = setInterval(function() {
        checkCount++;
        var elapsed = Date.now() - startTime;
        
        if (checkCount % 20 === 0) { // Log every 20 checks (about 1 second)
            console.log("DEBUG: Movement check #" + checkCount + ", elapsed: " + elapsed + "ms");
        }
        
        if (elapsed > timeout) {
            console.warn("DEBUG: MOVEMENT TIMEOUT at step", self.automation.step);
            console.warn("Current angles:", 
                "Base=" + self.arm.theta[self.arm.Base].toFixed(1) + 
                " Lower=" + self.arm.theta[self.arm.LowerArm].toFixed(1) + 
                " Upper=" + self.arm.theta[self.arm.UpperArm].toFixed(1));
            console.warn("Target angles:", 
                "Base=" + self.arm.targetTheta[self.arm.Base].toFixed(1) + 
                " Lower=" + self.arm.targetTheta[self.arm.LowerArm].toFixed(1) + 
                " Upper=" + self.arm.targetTheta[self.arm.UpperArm].toFixed(1));
            
            clearInterval(checkInterval);
            self.automation.step++;
            setTimeout(function() {
                self.executeNextStep();
            }, 500);
            return;
        }
        
        if (self.arm.isArmAtTarget()) {
            console.log("DEBUG: Arm reached target at step", self.automation.step);
            clearInterval(checkInterval);
            self.automation.step++;
            setTimeout(function() {
                self.executeNextStep();
            }, 500);
        }
    }, 50);
};

// ===== UPDATE LOOP =====

GripperAutomation.prototype.update = function() {
    if (!this.automation.active) return;

    if (this.gripState.holdingObject && this.arm.object) {
        let gPos = getGripperWorldPosition();
        this.arm.object.position.x = gPos[0];
        this.arm.object.position.y = gPos[1];
        this.arm.object.position.z = gPos[2];
        console.log("Moving object with gripper:", 
                   gPos[0].toFixed(2), gPos[1].toFixed(2), gPos[2].toFixed(2));
    }
};

// ===== STATUS =====

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

GripperAutomation.prototype.nextStep = function() {
    this.automation.step++;
    if (this.automation.step >= this.automation.routineSteps.length) {
        this.automation.active = false;
        this.arm.motionStatus("✓ Pick-and-place routine completed");
    }
};

// ===== HELPER FUNCTIONS =====

GripperAutomation.prototype.updateUI = function() {
    var status = this.getStatus();
    var autoStateEl = document.getElementById("auto-state");
    var gripperStateEl = document.getElementById("gripper-state");
    var holdingStateEl = document.getElementById("holding-state");
    var stepStateEl = document.getElementById("step-state");

    if (autoStateEl) autoStateEl.textContent = status.automationState;
    if (gripperStateEl) gripperStateEl.textContent = status.gripperState;
    if (holdingStateEl) holdingStateEl.textContent = status.holdingObject ? "Yes" : "No";
    if (stepStateEl) stepStateEl.textContent = status.active ? 
        "Step " + status.step + "/" + status.totalSteps : "Idle";
};

if (typeof window !== 'undefined') {
    window.GripperAutomation = GripperAutomation;
}

console.log("autoAnimation.js loaded - GripperAutomation available");