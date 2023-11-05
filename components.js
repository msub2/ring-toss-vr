AFRAME.registerComponent('pbr', {
  schema: {
    path: { type: 'string' },
    repeat: { type: 'number' }
  },

  init: function () {
    const textureLoader = new THREE.TextureLoader();
    const diff = textureLoader.load(`res/img/${this.data.path}/${this.data.path}_diff_1k.jpg`);
    diff.wrapS = THREE.RepeatWrapping;
    diff.wrapT = THREE.RepeatWrapping;
    diff.repeat.set(this.data.repeat, this.data.repeat);
    const norm = textureLoader.load(`res/img/${this.data.path}/${this.data.path}_nor_gl_1k.jpg`);
    norm.wrapS = THREE.RepeatWrapping;
    norm.wrapT = THREE.RepeatWrapping;
    norm.repeat.set(this.data.repeat, this.data.repeat);
    const arm = textureLoader.load(`res/img/${this.data.path}/${this.data.path}_arm_1k.jpg`);
    arm.wrapS = THREE.RepeatWrapping;
    arm.wrapT = THREE.RepeatWrapping;
    arm.repeat.set(this.data.repeat, this.data.repeat);
    this.el.object3D.children[0].material.aoMap = arm;
    this.el.object3D.children[0].material.map = diff;
    this.el.object3D.children[0].material.metalnessMap = arm;
    this.el.object3D.children[0].material.normalMap = norm;
    this.el.object3D.children[0].material.roughnessMap = arm;
  }
});

AFRAME.registerComponent('delayed-start', {
  schema: {},

  init: function () {
    document.addEventListener('enter-vr', () => {
      this.el.components.sound.playSound();
    })
  }
});
