"use strict";
// autoAnimation.js

function GripperAutomation(armControls) {
    this.arm = armControls;

    this.automation = {
        active: false,
        state: "idle",
        step: 0,
        routineSteps: [],
        delayBetweenSteps: 400
    };

    this.gripState = {
        state: "open",
        holdingObject: false
    };

    this.definePickAndPlaceRoutine();
}

// ================== GRIPPER ==================

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

// ================== ROUTINE ==================

GripperAutomation.prototype.definePickAndPlaceRoutine = function() {
    this.automation.routineSteps = [

        // 1. Move above box
        { type: "move", target: { base: 0, lower: 60, upper: 20 }, desc: "Move above box" },

        // 2. Lower to box
        { type: "move", target: { base: 0, lower: 110, upper: 20 }, desc: "Lower to box" },


        // 3. Grasp
        { type: "grasp", desc: "Grasping object" },

        // 4. Lift up
        { type: "move", target: { base: 0, lower: 40, upper: 10 }, desc: "Lifting object" },

        // 5. Move to place
        { type: "move", target: { base: 180, lower: 40, upper: 10 }, desc: "Move above place" },

        // 6. Lower to place
        { type: "move", target: { base: 180, lower: 110, upper: -70 }, desc: "Lower to place" },

        // 7. Release
        { type: "release", desc: "Releasing object" },

        // 8. Return home
        { type: "move", target: { base: 75, lower: 35, upper: 90 }, desc: "Returning home" }
    ];
};

// ================== CONTROL ==================

GripperAutomation.prototype.startPickAndPlace = function() {
    if (this.automation.active) {
        this.arm.motionStatus("Automation already running");
        return;
    }

    this.automation.active = true;
    this.automation.step = 0;
    this.automation.state = "starting";
    this.gripState.holdingObject = false;

    // Reset object
    if (this.arm.object) {
        this.arm.object.isPicked = false;
        this.arm.object.position.x = 5.0;
        this.arm.object.position.y = 0.5;
        this.arm.object.position.z = 0.0;
    }

    this.openGripper();
    this.arm.motionStatus("=== STARTING PICK & PLACE ===");

    var self = this;
    setTimeout(function() {
        self.executeNextStep();
    }, 600);
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

    if (this.arm.object) {
        this.arm.object.isPicked = false;
        this.arm.object.position.x = 5.0;
        this.arm.object.position.y = 0.5;
        this.arm.object.position.z = 0.0;
    }

    this.arm.motionStatus("Arm reset to home position");
};

// ================== STEPS ==================

GripperAutomation.prototype.executeNextStep = function() {
    if (!this.automation.active) return;

    if (this.automation.step >= this.automation.routineSteps.length) {
        this.automation.active = false;
        this.automation.state = "idle";
        this.arm.motionStatus("=== PICK & PLACE COMPLETED ===");
        return;
    }

    var step = this.automation.routineSteps[this.automation.step];
    this.automation.state = step.type;

    this.arm.motionStatus(
        "[Step " + (this.automation.step + 1) + "/" + this.automation.routineSteps.length + "] " + step.desc
    );

    var self = this;

    switch (step.type) {

        case "move":
            this.arm.targetTheta[this.arm.Base] = step.target.base;
            this.arm.targetTheta[this.arm.LowerArm] = step.target.lower;
            this.arm.targetTheta[this.arm.UpperArm] = step.target.upper;

            this.waitForMovementThenNext();
            break;

        case "grasp":
            // 🔴 SAFE GRASP (no distance checking, no freeze)
            this.closeGripper();

            setTimeout(function() {
                self.gripState.holdingObject = true;
                if (self.arm.object) self.arm.object.isPicked = true;

                self.arm.motionStatus("✓ Object grasped");
                self.automation.step++;
                self.executeNextStep();
            }, 600);
            break;

        case "release":
            this.openGripper();

            setTimeout(function() {
                if (self.arm.object) {
                    self.arm.object.isPicked = false;
                    self.arm.object.position.x = -5.0;
                    self.arm.object.position.y = 0.5;
                    self.arm.object.position.z = 0.0;
                }

                self.gripState.holdingObject = false;
                self.gripState.state = "open";

                self.arm.motionStatus("✓ Object released");
                self.automation.step++;
                self.executeNextStep();
            }, 700);
            break;
    }
};

GripperAutomation.prototype.waitForMovementThenNext = function() {
    var self = this;
    var startTime = Date.now();
    var timeout = 8000;

    var checkInterval = setInterval(function() {
        var elapsed = Date.now() - startTime;

        if (elapsed > timeout) {
            clearInterval(checkInterval);
            self.automation.step++;
            self.executeNextStep();
            return;
        }

        if (self.arm.isArmAtTarget()) {
            clearInterval(checkInterval);
            self.automation.step++;
            self.executeNextStep();
        }
    }, 50);
};

// ================== UPDATE LOOP ==================

GripperAutomation.prototype.update = function() {
    if (!this.automation.active) return;

    if (this.gripState.holdingObject && this.arm.object) {
        let gPos = this.arm.getGripperWorldPosition();
        
        // Only update if the box is not already very close to gripper
        let dx = gPos[0] - this.arm.object.position.x;
        let dy = gPos[1] - this.arm.object.position.y;
        let dz = gPos[2] - this.arm.object.position.z;
        let distSq = dx*dx + dy*dy + dz*dz;

        if (distSq > 0.0001) { // small threshold
            this.arm.object.position.x = gPos[0];
            this.arm.object.position.y = gPos[1];
            this.arm.object.position.z = gPos[2];
        }
    }
};

// ================== STATUS ==================

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

GripperAutomation.prototype.updateUI = function() {
    var status = this.getStatus();

    var autoStateEl = document.getElementById("auto-state");
    var gripperStateEl = document.getElementById("gripper-state");
    var holdingStateEl = document.getElementById("holding-state");
    var stepStateEl = document.getElementById("step-state");

    if (autoStateEl) autoStateEl.textContent = status.automationState;
    if (gripperStateEl) gripperStateEl.textContent = status.gripperState;
    if (holdingStateEl) holdingStateEl.textContent = status.holdingObject ? "Yes" : "No";
    if (stepStateEl) {
        stepStateEl.textContent = status.active
            ? "Step " + status.step + "/" + status.totalSteps
            : "Idle";
    }
};

if (typeof window !== "undefined") {
    window.GripperAutomation = GripperAutomation;
}

console.log("autoAnimation.js loaded – SAFE pick & place automation active");
