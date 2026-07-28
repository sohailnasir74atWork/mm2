/**
 * Confetti.jsx
 * Lightweight confetti burst component using RN Animated.
 * Exposes a `start()` method via React.forwardRef.
 */
import React, { useImperativeHandle, useRef, useState, useCallback, forwardRef } from 'react';
import { View, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

const COLORS = ['#FFD93D', '#4F46E5', '#EF4444', '#10B981', '#F472B6', '#3B82F6', '#FB923C', '#A78BFA'];
const PARTICLE_COUNT = 40;
const DURATION = 1800;

const Confetti = forwardRef((_, ref) => {
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const anims = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      rotate: new Animated.Value(0),
      scale: new Animated.Value(1),
    }))
  ).current;

  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      color: COLORS[i % COLORS.length],
      size: 6 + Math.random() * 6,
      isCircle: Math.random() > 0.5,
    }))
  ).current;

  const start = useCallback(() => {
    setVisible(true);
    const animations = anims.map((a, i) => {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.8;
      const velocity = 200 + Math.random() * 300;
      const targetX = Math.cos(angle) * velocity;
      const targetY = -200 - Math.random() * 400;
      const finalY = height * 0.6 + Math.random() * 200;

      a.x.setValue(0);
      a.y.setValue(0);
      a.opacity.setValue(1);
      a.rotate.setValue(0);
      a.scale.setValue(0.3);

      return Animated.parallel([
        Animated.timing(a.x, {
          toValue: targetX,
          duration: DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(a.y, {
            toValue: targetY,
            duration: DURATION * 0.35,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(a.y, {
            toValue: finalY,
            duration: DURATION * 0.65,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(a.scale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(a.opacity, {
            toValue: 0,
            duration: DURATION - 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(a.rotate, {
          toValue: 3 + Math.random() * 6,
          duration: DURATION,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]);
    });

    Animated.parallel(animations).start(() => setVisible(false));
  }, [anims, height]);

  useImperativeHandle(ref, () => ({ start }), [start]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {anims.map((a, i) => {
        const p = particles[i];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: width / 2,
              top: height * 0.35,
              width: p.size,
              height: p.size,
              borderRadius: p.isCircle ? p.size / 2 : 2,
              backgroundColor: p.color,
              opacity: a.opacity,
              transform: [
                { translateX: a.x },
                { translateY: a.y },
                { scale: a.scale },
                {
                  rotate: a.rotate.interpolate({
                    inputRange: [0, 10],
                    outputRange: ['0deg', '3600deg'],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
});

Confetti.displayName = 'Confetti';

export default Confetti;
