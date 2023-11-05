import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

AFRAME.registerComponent('rapier', {
  schema: {
    debug: { type: 'bool', default: false }
  },

  init: function () {
    this.physicsObjects = [];
    this.localVec3 = new THREE.Vector3();
    this.localQuat = new THREE.Quaternion();
    this.initRapier()
  },

  initRapier: async function () {
    await RAPIER.init();

    const gravity = { x: 0, y: -9.81, z: 0 }
    this.world = new RAPIER.World(gravity);
    this.eventQueue = new RAPIER.EventQueue(true);

    if (this.data.debug) {
      this.debugMesh = new THREE.LineSegments();
      this.debugMesh.material.vertexColors = true;
      this.debugMesh.renderOrder = Infinity;
      this.debugMesh.frustumCulled = false;
      AFRAME.scenes[0].object3D.add(this.debugMesh)
    }

    console.log(`[Physics] Initialized Rapier physics (version ${RAPIER.version()})`);
    this.el.emit('physics-started');
  },

  tick: function (time, timeDelta) {
    if (!this.world) return;

    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const col1 = this.world.getCollider(handle1);
      const col2 = this.world.getCollider(handle2);
      const rb1 = this.physicsObjects.find(obj => obj == col1.parent());
      const rb2 = this.physicsObjects.find(obj => obj == col2.parent());
      if (started) {
        document.dispatchEvent(new CustomEvent('collisionstart', {
          detail: {
            rb1,
            rb2
          }
        }));
      } else {
        document.dispatchEvent(new CustomEvent('collisionend', {
          detail: {
            rb1,
            rb2
          }
        }));
      }
    });

    this.physicsObjects.forEach(rigidBody => {
      /** @type {Mesh} */
      const mesh = rigidBody.userData.mesh;
      if (rigidBody.isDynamic()) {
        const position = rigidBody.translation();
        mesh.position.set(position.x, position.y, position.z);
        const rotation = rigidBody.rotation();
        mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      } else if (rigidBody.isKinematic()) {
        mesh.getWorldPosition(this.localVec3);
        mesh.getWorldQuaternion(this.localQuat);
        rigidBody.setTranslation(this.localVec3, true);
        rigidBody.setRotation(this.localQuat, true);
      }
    });

    if (this.debugMesh) {
      const buffers = this.world.debugRender();
      const vertices = new THREE.BufferAttribute(buffers.vertices, 3);
      const colors = new THREE.BufferAttribute(buffers.colors, 4);

      this.debugMesh.geometry.setAttribute('position', vertices);
      this.debugMesh.geometry.setAttribute('color', colors);
    }
  }
});

AFRAME.registerComponent('rapier-body', {
  schema: {
    shape: { type: 'string', default: 'cuboid' },
    type: { type: 'string', default: 'dynamic' },
    isTrigger: { type: 'bool', default: false }
  },

  init: function () {
    AFRAME.scenes[0].addEventListener('physics-started', () => {
      this.rapier = AFRAME.scenes[0].components.rapier;

      const mesh = this.el.object3D.children[0];
      const parentMesh = this.el.object3D;
      let colliderDesc, rigidBodyDesc;

      switch (this.data.shape) {
        case "ball": {
          mesh.geometry.computeBoundingSphere();
          colliderDesc = RAPIER.ColliderDesc.ball(mesh.geometry.boundingSphere.radius);
          break;
        }
        case "cuboid": {
          const size = new THREE.Vector3();
          mesh.geometry.computeBoundingBox();
          mesh.geometry.boundingBox.getSize(size);
          size.multiply(mesh.scale);
          colliderDesc = RAPIER.ColliderDesc.cuboid(Math.max(size.x / 2, .005), Math.max(size.y / 2, .005), Math.max(size.z / 2, .005));
          break;
        }
        case "plane": {
          const size = new THREE.Vector3();
          mesh.planeMesh.geometry.computeBoundingBox();
          mesh.planeMesh.geometry.boundingBox.getSize(size);
          colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
          break;
        }
        case "trimesh":
          const scaledVertexPositions = mesh.geometry.getAttribute('position').array.slice();
          for (let i = 0; i < scaledVertexPositions.length; i += 3) {
            scaledVertexPositions[i] = scaledVertexPositions[i] * mesh.scale.x;
            scaledVertexPositions[i + 1] = scaledVertexPositions[i + 1] * mesh.scale.y;
            scaledVertexPositions[i + 2] = scaledVertexPositions[i + 2] * mesh.scale.z;
          }
          colliderDesc = RAPIER.ColliderDesc.trimesh(scaledVertexPositions, mesh.geometry.index.array);
          break;
      }
      if (this.data.isTrigger) colliderDesc.setSensor(true);
      colliderDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      switch (this.data.type) {
        case "dynamic":
          rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
          break;
        case "kinematicPosition":
          rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
          break;
        case "kinematicVelocity":
          rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
          break;
        case "fixed":
          rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
          break;
      }
      rigidBodyDesc.setTranslation(parentMesh.position.x, parentMesh.position.y, parentMesh.position.z);
      rigidBodyDesc.setRotation(parentMesh.quaternion);

      this.rigidBody = this.rapier.world.createRigidBody(rigidBodyDesc);
      this.rapier.world.createCollider(colliderDesc, this.rigidBody);
      this.rigidBody.userData = { mesh: parentMesh, entity: this.el };
      this.rapier.physicsObjects.push(this.rigidBody);
    })
  }
});

/// COMPONENTS

AFRAME.registerComponent('grab', {
  schema: {
    listenFor: { type: 'string', oneOf: ['collision', 'trigger'], default: 'collision' }
  },

  init: function () {
    this.canGrab = false;
    this.grabbable = null;
    this.activeGrabbable = null;

    // Hook up event listeners for the relevant grabbing input events
    this.el.addEventListener('buttondown', (event) => {
      if (event.detail.id === 0) {
        if (this.canGrab && this.grabbable) {
          this.grabbable.components.grabbable.grab(this.el);
          this.activeGrabbable = this.grabbable;
        }
      }
    });
    this.el.addEventListener('buttonup', (event) => {
      if (event.detail.id === 0) {
        if (this.activeGrabbable) {
          this.activeGrabbable.components.grabbable.release();
          this.activeGrabbable = null;
        }
      }
    });
    document.addEventListener(`${this.data.listenFor}start`, e => {
      const { rb1, rb2 } = e.detail;
      if (rb1.userData.entity.components.grabbable && rb2.userData.entity.components.grab) {
        this.canGrab = true;
        this.grabbable = rb1.userData.entity;
      } else if (rb2.userData.entity.components.grabbable && rb1.userData.entity.components.grab) {
        this.canGrab = true;
        this.grabbable = rb2.userData.entity;
      }
    });
    document.addEventListener(`${this.data.listenFor}end`, e => {
      const { rb1, rb2 } = e.detail;
      if (rb1.userData.entity.components.grabbable || rb2.userData.entity.components.grabbable) {
        this.canGrab = false;
        this.grabbable = null;
      }
    });
  }
});

AFRAME.registerComponent('grabbable', {
  schema: {
    preserveVelocity: { type: 'boolean', default: true }
  },

  init: function () {
    this.body = null;
    this.grabbed = false;
    this.released = false;
    this.parent = null;
    this.parentPos = new THREE.Vector3();

    this.prevPos = new THREE.Vector3();
    this.prevDelta = 0;
    this.prevQuat = new THREE.Quaternion();

    this.body = this.el.components['rapier-body'];
  },

  tick: function(t, dt) {
    if (this.grabbed) {
      if (this.data.preserveVelocity) {
        this.prevDelta = dt;
        this.prevPos.copy(this.el.object3D.position);
      }
      if (this.parent) {
        this.parent.getWorldPosition(this.parentPos);
        const { w, x, y, z } = this.parent.getWorldQuaternion(this.prevQuat);

        this.body.rigidBody.setTranslation({ x: this.parentPos.x, y: this.parentPos.y, z: this.parentPos.z });
        this.body.rigidBody.setRotation({ w, x, y, z });
      }
    } else if (this.released && this.data.preserveVelocity) {
      if (this.body.rigidBody.isDynamic()) {
        this.applyVelocity(dt);
        this.released = false;
      }
    }
  },

  grab: function(parent) {
    this.grabbed = true;
    this.released = false;
    let params = RAPIER.JointData.fixed(
      { x: 0.0, y: 0.0, z: 0.0 },
      { w: 1.0, x: 0.0, y: 0.0, z: 0.0 },
      { x: 0.0, y: -0.1, z: 0.0 },
      { w: 1.0, x: 0.0, y: 0.0, z: 0.0 }
    );
    this.joint = AFRAME.scenes[0].components.rapier.world.createImpulseJoint(params, parent.components['rapier-body'].rigidBody, this.el.components['rapier-body'].rigidBody, true);
    this.parent = parent.object3D;
  },

  release: function () {
    this.grabbed = false;
    this.released = true;
    AFRAME.scenes[0].components.rapier.world.removeImpulseJoint(this.joint, true);
    this.parent = null;
    setTimeout(() => {
      this.body.rigidBody.setTranslation({x: .5, y: 1.5, z: 0});
      document.dispatchEvent(new CustomEvent('ring-reset'));
    }, 5000);
  },

  applyVelocity: function (dt) {
    const velocity = this.prevPos.sub(this.el.object3D.position).divideScalar(-dt * 2).applyQuaternion(this.prevQuat.invert());
    this.body.rigidBody.applyImpulse({ x: velocity.x, y: velocity.y, z: velocity.z}, true);
  }
});

AFRAME.registerComponent('score-increaser', {
  schema: {
    peg: { type: 'number' }
  },

  init: function () {
    this.left = `peg${this.data.peg}Left`;
    this.right = `peg${this.data.peg}Right`;
    this.leftHit = false;
    this.rightHit = false;
    this.gotPoints = false;

    document.addEventListener('collisionstart', e => {
      const { rb1, rb2 } = e.detail;
      if (rb1.userData.entity?.id == this.left || rb2.userData.entity?.id == this.left) {
        this.leftHit = true;
      } else if (rb1.userData.entity?.id == this.right || rb2.userData.entity?.id == this.right) {
        this.rightHit = true;
      }
    });

    document.addEventListener('collisionend', e => {
      const { rb1, rb2 } = e.detail;
      if (rb1.userData.entity?.id == this.left || rb2.userData.entity?.id == this.left) {
        this.leftHit = false;
      } else if (rb1.userData.entity?.id == this.right || rb2.userData.entity?.id == this.right) {
        this.rightHit = false;
      }
    });
  },

  tick: function (time, timeDelta) {
    if (this.leftHit && this.rightHit && !this.gotPoints) {
      this.gotPoints = true;
      document.querySelector('#score').components.score.increaseScore(25);
      document.querySelector('#scored').components.sound.playSound();
      document.addEventListener('ring-reset', () => {
        this.gotPoints = false;
      })
    }
  }
});

AFRAME.registerComponent('score', {
  schema: {},

  init: function () {
    this.text = this.el.components.text;
    this.score = 0;
  },

  increaseScore: function(amount) {
    this.score += amount;
    this.el.setAttribute('text', { value: `Score: ${this.score}` });
  }
});
